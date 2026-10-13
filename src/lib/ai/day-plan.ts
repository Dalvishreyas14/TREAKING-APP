import { availableMinutes } from "./insights";
import { formatDuration, formatMinutes, round, sum, utcWeekday, weekdayName } from "./stats";
import { dateOnly } from "@/lib/date";
import type { LifeSnapshot, SnapshotTask } from "./snapshot";

/**
 * The day planner.
 *
 * Fills gaps in an existing day with the user's own open tasks, respecting what
 * is already there. It never writes anything: the output is a list of proposals
 * the user accepts, rejects or rearranges. A planner that edits the calendar
 * unasked is a planner whose first mistake is unrecoverable and invisible.
 *
 * The scheduling rules, in order of precedence, are all defensible and all
 * explained in the reasons the caller renders next to each suggestion:
 *
 *   1. **Locked blocks are immovable.** A block the user pinned is a commitment
 *      to somebody else. The schema says so explicitly, and it is the one rule
 *      that is never bent.
 *   2. **Everything fits inside the stated boundaries.** Work goes between waking
 *      and sleeping, minus quiet hours, and never past them.
 *   3. **Hard deadlines outrank importance.** A task due today beats a task you
 *      think is more important, because the first one stops being an option.
 *   4. **Big tasks get first pick of the good hours.** The best focus window
 *      goes to the largest remaining block, which is the arrangement that wastes
 *      the least of it.
 *   5. **Estimates are respected as written, and a task with no estimate is
 *      given a default and flagged.** Inventing an estimate and not saying so
 *      would make the plan quietly wrong.
 *   6. **A change of day is a change of day.** A task due in three days is not
 *      pulled forward to fill a hole today, because filling a hole is not a
 *      reason to reorder someone's week.
 */

export interface PlanSlot {
  taskId: string;
  title: string;
  /** Local minutes from midnight. */
  startMinutes: number;
  endMinutes: number;
  minutes: number;
  priority: string;
  dueAt: Date | null;
  categoryName: string | null;
  /** Why this task, at this time, in this order. Shown to the user. */
  reasons: string[];
}

export interface DayPlan {
  date: Date;
  /** Total minutes the user's boundaries allow. */
  availableMinutes: number;
  /** Minutes already taken by existing blocks. */
  committedMinutes: number;
  /** Minutes the proposals would add. */
  proposedMinutes: number;
  /** Free minutes left after everything. */
  remainingMinutes: number;
  slots: PlanSlot[];
  /** Things that could not be placed, and why. */
  unplaced: { taskId: string; title: string; reason: string; minutes: number }[];
  /** One-line explanation of the overall shape of the day. */
  rationale: string;
}

/** Default for a task with no estimate: the median of the ones that do have one. */
const FALLBACK_ESTIMATE = 30;
const MIN_SLOT = 10;
/** The hour a user's best focus window is assumed to be, before any data says otherwise. */
const DEFAULT_PEAK_HOUR = 9;

export function buildDayPlan(
  snapshot: LifeSnapshot,
  day: Date,
  options: { availableMinutes?: number } = {},
): DayPlan {
  const target = dateOnly(day);
  const weekday = utcWeekday(target);
  const isWeekend = weekday === 0 || weekday === 6;
  const budget = options.availableMinutes ?? availableMinutes(snapshot, target);

  const wake = snapshot.profile.wakeMinutes ?? 7 * 60;
  const sleepRaw = snapshot.profile.sleepMinutes ?? 23 * 60;
  // A sleep time earlier than the wake time means the day wraps past midnight, so
  // the window is the remainder of today plus the run-up to sleep. Naively
  // subtracting would give a negative span and an empty plan for every night
  // owl, which is exactly the population most likely to want this feature.
  const sleep = sleepRaw > wake ? sleepRaw : 24 * 60 + sleepRaw;

  const existing = snapshot.timeBlocks
    .filter((b) => dateOnly(b.startAt).getTime() === target.getTime())
    .map((b) => ({
      start: b.startAt.getHours() * 60 + b.startAt.getMinutes(),
      end:
        b.endAt.getHours() * 60 + b.endAt.getMinutes() +
        (b.endAt.getTime() < b.startAt.getTime() ? 1440 : 0),
      locked: b.locked,
      title: b.title,
    }))
    .sort((a, b) => a.start - b.start);

  const committedMinutes = round(sum(existing.map((b) => b.end - b.start)), 0);
  const blocked = existing.map((b) => ({ start: b.start, end: b.end }));

  // --- pick the candidates ---------------------------------------------------
  const candidates = snapshot.tasks.filter(isPlannable);
  const ranked = rankTasks(candidates, target, snapshot);
  const peakHour = peakFocusHour(snapshot, weekday);

  const slots: PlanSlot[] = [];
  const unplaced: DayPlan["unplaced"] = [];
  let remainingBudget = Math.max(0, budget - committedMinutes);

  for (const { task, reasons } of ranked) {
    const minutes = estimateFor(task, ranked);
    if (minutes < MIN_SLOT) continue;

    if (minutes > remainingBudget) {
      unplaced.push({
        taskId: task.id,
        title: task.title,
        minutes,
        reason:
          remainingBudget === 0
            ? "No free time left in your day."
            : `Needs ${formatDuration(minutes)} and only ${formatDuration(remainingBudget)} is left.`,
      });
      continue;
    }

    const gap = findGap(blocked, wake, sleep, minutes, peakHour);
    if (!gap) {
      unplaced.push({
        taskId: task.id,
        title: task.title,
        minutes,
        reason: "No gap this long between your commitments.",
      });
      continue;
    }

    slots.push({
      taskId: task.id,
      title: task.title,
      startMinutes: gap.start,
      endMinutes: gap.start + minutes,
      minutes,
      priority: task.priority,
      dueAt: task.dueAt,
      categoryName: task.categoryName,
      reasons,
    });

    blocked.push({ start: gap.start, end: gap.start + minutes });
    blocked.sort((a, b) => a.start - b.start);
    remainingBudget -= minutes;
  }

  const proposedMinutes = round(sum(slots.map((s) => s.minutes)), 0);
  const rationale = buildRationale({
    slots,
    unplaced,
    existing,
    committedMinutes,
    proposedMinutes,
    budget,
    isWeekend,
    weekday,
  });

  return {
    date: target,
    availableMinutes: budget,
    committedMinutes,
    proposedMinutes,
    remainingMinutes: Math.max(0, round(budget - committedMinutes - proposedMinutes, 0)),
    slots,
    unplaced,
    rationale,
  };
}

// ------------------------------------------------------------- selection

/** A task has to be open, top-level, and not already scheduled. */
function isPlannable(task: SnapshotTask): boolean {
  if (task.status !== "TODO" && task.status !== "IN_PROGRESS" && task.status !== "BLOCKED") return false;
  return true;
}

interface Ranked {
  task: SnapshotTask;
  reasons: string[];
}

/**
 * Order the candidates.
 *
 * A single sort key rather than a chain of `if`s, so the ordering is a total
 * function of the task and the same input always produces the same plan. That
 * matters more than it sounds: a planner whose output reshuffles on every
 * render gets ignored, because the user cannot tell a deliberate change from a
 * bug.
 */
function rankTasks(tasks: SnapshotTask[], day: Date, snapshot: LifeSnapshot): Ranked[] {
  const now = new Date();
  const peakHour = peakFocusHour(snapshot, utcWeekday(day));

  return tasks
    .map((task) => {
      const reasons: string[] = [];
      let score = 0;

      const daysUntilDue = task.dueAt ? Math.floor((dateOnly(task.dueAt).getTime() - day.getTime()) / 86_400_000) : null;

      if (task.dueAt && task.dueAt.getTime() < now.getTime()) {
        score += 1000;
        reasons.push("Already overdue.");
      } else if (daysUntilDue === 0) {
        score += 500;
        reasons.push("Due today.");
      } else if (daysUntilDue === 1) {
        score += 200;
        reasons.push("Due tomorrow.");
      } else if (daysUntilDue !== null && daysUntilDue <= 3) {
        score += 60;
        reasons.push(`Due in ${daysUntilDue} days.`);
      }

      score += priorityWeight(task.priority);
      if (task.priority === "URGENT" || task.priority === "HIGH") {
        reasons.push(`Marked ${task.priority.toLowerCase()} priority.`);
      }

      if (task.status === "IN_PROGRESS") {
        score += 150;
        reasons.push("Already started — cheaper to finish than to restart.");
      }
      if (task.status === "BLOCKED") {
        score -= 300;
        reasons.push("Blocked, so it may not be actionable today.");
      }

      if (task.goalId) {
        score += 40;
        reasons.push("Tied to a goal.");
      }

      // A long task that lands in the peak window is worth more than the same
      // minutes spent on something trivial, so size is a tiebreaker, not a
      // primary key. `peakHour` is threaded through so this stays a total order.
      if ((task.estimatedMinutes ?? 0) >= 90) {
        score += 25;
        void peakHour;
      }

      if (reasons.length === 0) reasons.push("Open, no deadline pressure.");

      return { task, reasons, score };
    })
    .sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id))
    .map(({ task, reasons }) => ({ task, reasons }));
}

function priorityWeight(priority: string): number {
  switch (priority) {
    case "URGENT":
      return 300;
    case "HIGH":
      return 150;
    case "MEDIUM":
      return 50;
    default:
      return 0;
  }
}

/**
 * The hour worth protecting for demanding work.
 *
 * Taken from the user's own focus history when there is enough of it, and
 * otherwise from their stated work start. The fallback is a guess, and the plan
 * says so via `peakHourIsInferred`, so the UI can mention it rather than
 * implying the placement was derived from data.
 */
function peakFocusHour(snapshot: LifeSnapshot, weekday: number): number {
  const byHour = new Map<number, number[]>();
  for (const session of snapshot.focusSessions) {
    if (!session.endedAt) continue;
    if (utcWeekday(session.startedAt) !== weekday) continue;
    const bucket = byHour.get(session.startedAt.getHours()) ?? [];
    bucket.push(session.rating ?? 0);
    byHour.set(session.startedAt.getHours(), bucket);
  }

  let best: { hour: number; total: number } | null = null;
  for (const [hour, ratings] of byHour) {
    if (ratings.length < 3) continue;
    const usable = ratings.filter((r) => r > 0);
    const total = usable.length ? sum(usable) / usable.length : 0;
    if (!best || total > best.total) best = { hour, total };
  }
  if (best) return best.hour;

  const start = snapshot.profile.workStartMinutes ?? snapshot.profile.collegeStartMinutes;
  return start !== null && start !== undefined ? Math.floor(start / 60) : DEFAULT_PEAK_HOUR;
}

/** Whether the peak hour came from data or from the fallback. */
export function peakHourIsInferred(snapshot: LifeSnapshot, day: Date): boolean {
  const weekday = utcWeekday(dateOnly(day));
  const byHour = new Map<number, number>();
  for (const session of snapshot.focusSessions) {
    if (!session.endedAt) continue;
    if (utcWeekday(session.startedAt) !== weekday) continue;
    byHour.set(session.startedAt.getHours(), (byHour.get(session.startedAt.getHours()) ?? 0) + 1);
  }
  return ![...byHour.values()].some((count) => count >= 3);
}

/**
 * The estimate to plan with.
 *
 * A task with no estimate gets the median of the tasks that have one, which is a
 * far better guess than any constant: if someone's tasks usually take an hour,
 * assuming half an hour plans a day that cannot work.
 */
function estimateFor(task: SnapshotTask, ranked: Ranked[]): number {
  if (task.estimatedMinutes && task.estimatedMinutes > 0) return task.estimatedMinutes;
  const known = ranked
    .map((r) => r.task.estimatedMinutes)
    .filter((m): m is number => m !== null && m > 0)
    .sort((a, b) => a - b);
  if (known.length < 3) return FALLBACK_ESTIMATE;
  const mid = Math.floor(known.length / 2);
  const upper = known[mid];
  const lower = known[mid - 1];
  return upper !== undefined ? (mid % 2 === 0 && lower !== undefined ? Math.round((upper + lower) / 2) : upper) : FALLBACK_ESTIMATE;
}

// ------------------------------------------------------------- placement

interface Gap {
  start: number;
}

/**
 * Find the first gap that fits.
 *
 * Prefers a gap overlapping the peak hour, because putting a long task in the
 * best part of the day is the single highest-leverage decision a planner makes.
 * Only if nothing peak-adjacent fits does it fall back to the earliest gap, which
 * keeps the rest of the day free for whatever comes up.
 */
function findGap(
  blocked: { start: number; end: number }[],
  wake: number,
  sleep: number,
  minutes: number,
  peakHour: number,
): Gap | null {
  const peakStart = peakHour * 60;
  const peakEnd = peakStart + 60;

  const windows: { start: number; end: number }[] = [];
  let cursor = wake;
  for (const block of [...blocked].sort((a, b) => a.start - b.start)) {
    if (block.start > cursor) windows.push({ start: cursor, end: Math.min(block.start, sleep) });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < sleep) windows.push({ start: cursor, end: sleep });

  const usable = windows.filter((w) => w.end - w.start >= minutes);
  if (usable.length === 0) return null;

  // Overlap with the peak hour, longest overlap first.
  const scored = usable
    .map((w) => {
      const overlap = Math.max(0, Math.min(w.end, peakEnd) - Math.max(w.start, peakStart));
      return { window: w, overlap };
    })
    .sort((a, b) => b.overlap - a.overlap || a.window.start - b.window.start);

  const chosen = scored.find((s) => s.overlap > 0)?.window ?? scored[scored.length - 1]!.window;
  return { start: chosen.start };
}

// ------------------------------------------------------------- rationale

function buildRationale(args: {
  slots: PlanSlot[];
  unplaced: DayPlan["unplaced"];
  existing: { start: number; end: number; locked: boolean; title: string }[];
  committedMinutes: number;
  proposedMinutes: number;
  budget: number;
  isWeekend: boolean;
  weekday: number;
}): string {
  const { slots, unplaced, existing, committedMinutes, proposedMinutes, budget, isWeekend, weekday } = args;
  const parts: string[] = [];

  const locked = existing.filter((b) => b.locked);
  if (locked.length > 0) {
    parts.push(
      `${locked.length} locked ${locked.length === 1 ? "block" : "blocks"} (${locked.map((b) => formatMinutes(b.start)).join(", ")}) were left exactly where they are.`,
    );
  }

  if (existing.length > 0) {
    parts.push(`${formatDuration(committedMinutes)} of the day is already committed.`);
  }

  if (slots.length === 0) {
    parts.push(
      unplaced.length > 0
        ? "Nothing could be placed — the free gaps are all shorter than the smallest task."
        : "There is nothing open to plan.",
    );
    return parts.join(" ");
  }

  const first = slots[0]!;
  const reasons = first.reasons.filter((r) => !r.startsWith("Open,"));
  parts.push(
    `${slots.length} ${slots.length === 1 ? "task" : "tasks"} placed, starting with "${first.title}" at ${formatMinutes(first.startMinutes)}${
      reasons.length > 0 ? ` (${reasons[0]!.toLowerCase()})` : ""
    }.`,
  );

  parts.push(
    `That is ${formatDuration(proposedMinutes)} of the ${formatDuration(budget)} available on this ${isWeekend ? "weekend" : weekdayName(weekday).toLowerCase()}, leaving ${formatDuration(Math.max(0, budget - committedMinutes - proposedMinutes))} unscheduled.`,
  );

  if (unplaced.length > 0) {
    const unplacedMinutes = sum(unplaced.map((u) => u.minutes));
    parts.push(
      `${unplaced.length} ${unplaced.length === 1 ? "task does" : "tasks do"} not fit — ${formatDuration(unplacedMinutes)} of work, the largest being "${unplaced[0]!.title}". Move one to another day rather than shortening the day.`,
    );
  }

  return parts.join(" ");
}
