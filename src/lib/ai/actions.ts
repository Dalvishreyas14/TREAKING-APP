import { dateOnlyLocal } from "@/lib/date";
import { formatLocalWeekdayClock } from "@/lib/format/date";
import { formatDuration } from "@/lib/ai/stats";
import type { HabitDifficulty, TaskStatus } from "@/generated/prisma/enums";

/**
 * The action executor's vocabulary.
 *
 * An insight is a claim. An action is a change. This module is the only place
 * that knows what an `Insight.actionKind` means, and it is deliberately a pure
 * function of a read model plus a payload:
 *
 *   planAction(ctx, kind, payload)  -> ActionPlan    // what would change, right now
 *   planWrites(ctx, kind, payload) -> ActionWrite[] // the writes that diff implies
 *
 * The split between "what" and "how" is the safety property of the whole feature.
 * An insight stores the *argument* for a change ("these five tasks are overdue"),
 * never the result, and that argument can be days old. The rows it names may have
 * been completed, deleted or edited since, so nothing is ever applied from the
 * stored payload alone:
 *
 *   - preview re-reads live state and recomputes the diff;
 *   - apply re-plans *inside the transaction* and returns the diff it actually
 *     performed, not the one that was shown.
 *
 * So if the world moves between preview and confirm, the user sees what happened
 * rather than a summary that quietly stopped being true. That is the whole reason
 * the type is a plan rather than a command.
 *
 * Deliberately not a general tool-calling layer. There is no model picking
 * arguments at runtime here; the only writer of `actionPayload` is this repo's own
 * deterministic engine, and keeping the payload shape under a hand-written
 * validator means a malformed or stale payload produces a refusal with a reason
 * rather than a write nobody intended.
 */

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/**
 * The slice of a user's data an action is allowed to look at.
 *
 * Deliberately narrower than `LifeSnapshot` and shaped by what the actions
 * actually read. A smaller surface is what makes it possible to assert, in a
 * test, that planning an action cannot reach a field it has no business
 * touching.
 */
export interface ActionTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  importance: number;
  dueAt: Date | null;
  startAt: Date | null;
  snoozedUntil: Date | null;
  estimatedMinutes: number | null;
  createdAt: Date;
}

export interface ActionHabit {
  id: string;
  name: string;
  isActive: boolean;
  archivedAt: Date | null;
  frequency: string;
  difficulty: HabitDifficulty;
  targetValue: number;
  timesPerPeriod: number | null;
  preferredMinutes: number | null;
  reminderEnabled: boolean;
  reminderMinutes: number | null;
  /** ISO `YYYY-MM-DD` days already logged, within the lookback window. */
  loggedDates: string[];
}

export interface ActionGoal {
  id: string;
  title: string;
  status: string;
  progress: number;
  targetDate: Date | null;
}

export interface ActionProfile {
  sleepMinutes: number | null;
  wakeMinutes: number | null;
  availableWeekdayMinutes: number | null;
  availableWeekendMinutes: number | null;
}

export interface ActionContext {
  /** The instant the plan is computed against. Passed in, never read from `Date`. */
  now: Date;
  tasks: ActionTask[];
  habits: ActionHabit[];
  goals: ActionGoal[];
  profile: ActionProfile | null;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type ActionTarget = "Task" | "HabitLog" | "Habit" | "Goal" | "Profile";

/** One field-level before/after. This is what the confirmation dialog renders. */
export interface ActionChange {
  target: ActionTarget;
  targetId: string;
  /** The row's human name, so a diff of twelve tasks is readable. */
  targetLabel: string;
  field: string;
  before: string | null;
  after: string | null;
}

export interface ActionPlan {
  kind: string;
  /** Short human name for the action, e.g. "Log a habit". */
  label: string;
  /** One sentence, written for someone deciding whether to tap. */
  summary: string;
  /**
   * False when the payload no longer describes a possible change — the row was
   * deleted, the date was already logged, the advice has no writable home.
   * `reason` is then the user-facing explanation, never null.
   */
  applicable: boolean;
  reason: string | null;
  changes: ActionChange[];
}

/**
 * The writes a plan implies.
 *
 * A discriminated union rather than a generic `{ model, data }` pair so that
 * `applyWrites` narrows to the right Prisma call under `exactOptionalPropertyTypes`
 * and a malformed write is a compile error rather than a runtime rejection.
 */
export type ActionWrite =
  | {
      op: "task.update";
      id: string;
      data: {
        status?: TaskStatus;
        dueAt?: Date | null;
        startAt?: Date | null;
        snoozedUntil?: Date | null;
        importance?: number;
      };
    }
  | {
      op: "habit.update";
      id: string;
      data: {
        targetValue?: number;
        difficulty?: HabitDifficulty;
        reminderEnabled?: boolean;
        reminderMinutes?: number | null;
      };
    }
  | { op: "habit.log"; habitId: string; date: string; value: number; completed: boolean }
  | { op: "goal.update"; id: string; data: { targetDate?: Date | null } }
  | { op: "profile.update"; data: { sleepMinutes?: number } };

/** A plan plus the writes that produced it, from a single evaluation. */
export interface ActionEvaluation {
  plan: ActionPlan;
  writes: ActionWrite[];
}

const OPEN_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
]);
const CLOSED_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "DONE",
  "CANCELLED",
  "ARCHIVED",
]);

/**
 * How many rows one action may touch.
 *
 * A preview that lists two hundred tasks is not a confirmation, it is a wall of
 * text nobody reads before tapping. Every action that works on a set rather than
 * a single row is capped, and the cap is stated in the summary so the number in
 * the dialog is visibly the number in the sentence.
 */
const MAX_BULK_CHANGES = 8;

const DIFFICULTY_LADDER = ["EASY", "MEDIUM", "HARD"] as const;

/**
 * Fallback daily capacity when the profile has not been filled in.
 *
 * Matches the onboarding default of four hours, so an incomplete profile plans
 * the same way the form that produced it would.
 */
const DEFAULT_AVAILABLE_MINUTES = 4 * 60;

/** 8pm on the day named by a UTC-midnight `date`, as a real local instant. */
function localTimeOn(date: Date, hours: number): Date {
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    hours,
    0,
    0,
    0,
  );
}

/** `date` shifted by whole days, keeping the time of day. */
function shiftDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function instant(date: Date | null): string | null {
  return date ? formatLocalWeekdayClock(date) : null;
}

function isPastDue(task: ActionTask, now: Date): boolean {
  if (CLOSED_TASK_STATUSES.has(task.status)) return false;
  if (task.snoozedUntil && task.snoozedUntil > now) return false;
  if (task.dueAt) return task.dueAt < now;
  // An undated task is not "overdue" in the calendar sense, but a stale one still
  // deserves triage, so it counts once it is well past its creation date.
  return now.getTime() - task.createdAt.getTime() > 7 * 86_400_000;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

interface ActionSpec {
  label: string;
  plan: (ctx: ActionContext, payload: Record<string, unknown>) => ActionEvaluation;
}

function evaluate(
  plan: Omit<ActionPlan, "applicable" | "reason" | "changes">,
  changes: ActionChange[],
  writes: ActionWrite[],
  reason?: string,
): ActionEvaluation {
  // A plan with changes but a refusal reason is incoherent, and a plan with no
  // changes is not an action. Both are bugs in a spec, so they are caught here
  // rather than rendered as an empty dialog the user cannot act on.
  if (reason && writes.length > 0) {
    throw new Error(`action ${plan.kind} produced writes for a refused plan`);
  }
  if (!reason && writes.length === 0) {
    throw new Error(`action ${plan.kind} produced no writes and no reason`);
  }
  return {
    plan: {
      ...plan,
      applicable: reason === undefined,
      reason: reason ?? null,
      changes: reason === undefined ? changes : [],
    },
    writes: reason === undefined ? writes : [],
  };
}

/** Log one habit for one day. The only action that creates a row. */
const logHabit: ActionSpec = {
  label: "Log a habit",
  plan(ctx, payload) {
    const habitId = typeof payload.habitId === "string" ? payload.habitId : "";
    const date = typeof payload.date === "string" ? payload.date : "";
    const base = { kind: "LOG_HABIT", label: this.label, summary: "" };

    const habit = ctx.habits.find((h) => h.id === habitId);
    if (!habit) return evaluate(base, [], [], "That habit no longer exists.");
    if (!habit.isActive || habit.archivedAt) {
      return evaluate(base, [], [], `"${habit.name}" is paused, so there is nothing to log.`);
    }
    if (habit.loggedDates.includes(date)) {
      return evaluate(
        base,
        [],
        [],
        `"${habit.name}" is already logged for ${date}. This suggestion has been done.`,
      );
    }

    const value = habit.frequency === "WEEKLY" ? 1 : habit.targetValue;
    return evaluate(
      {
        ...base,
        summary: `Add "${habit.name}" to ${date}.`,
      },
      [
        {
          target: "HabitLog",
          targetId: habit.id,
          targetLabel: habit.name,
          field: date,
          before: null,
          after: `${value} of ${habit.targetValue}`,
        },
      ],
      [{ op: "habit.log", habitId: habit.id, date, value, completed: true }],
    );
  },
};

/** Push overdue tasks onto today at a civilised hour. */
const triageOverdue: ActionSpec = {
  label: "Reschedule overdue tasks",
  plan(ctx, payload) {
    const ids = Array.isArray(payload.taskIds)
      ? payload.taskIds.filter((v): v is string => typeof v === "string")
      : [];
    const base = { kind: "TRIAGE_OVERDUE", label: this.label, summary: "" };

    // Ownership is enforced by the context loader scoping the query to `userId`,
    // so a task id that is not in here is either deleted or somebody else's. Both
    // answer the same way: it is not a row this action may touch.
    const due = ctx.tasks
      .filter((t) => ids.includes(t.id) && isPastDue(t, ctx.now))
      .slice(0, MAX_BULK_CHANGES);

    if (due.length === 0) {
      return evaluate(
        base,
        [],
        [],
        "None of those tasks are overdue any more. They have been done or rescheduled since.",
      );
    }

    const target = localTimeOn(dateOnlyLocal(ctx.now), 20);
    const truncated = ids.length - due.length;
    return evaluate(
      {
        ...base,
        summary: `Move ${due.length} overdue ${due.length === 1 ? "task" : "tasks"} to 8pm today${
          truncated > 0 ? ` (${truncated} already resolved)` : ""
        }.`,
      },
      due.map((task) => ({
        target: "Task" as const,
        targetId: task.id,
        targetLabel: task.title,
        field: "Due",
        before: instant(task.dueAt) ?? "no date",
        after: formatLocalWeekdayClock(target),
      })),
      due.map((task) => ({ op: "task.update" as const, id: task.id, data: { dueAt: target } })),
    );
  },
};

/**
 * Archive the oldest undated open tasks.
 *
 * The payload carries a strategy but no ids, so the set is re-derived from live
 * state — which is the point: "the oldest ten things I never dated" is a
 * statement about now, not about the moment the insight was generated.
 */
const archiveStale: ActionSpec = {
  label: "Archive stale tasks",
  plan(ctx, payload) {
    const base = { kind: "ARCHIVE_STALE", label: this.label, summary: "" };
    if (payload.strategy !== "oldest_first") {
      return evaluate(
        base,
        [],
        [],
        "This suggestion was written for a strategy LIFEOS does not implement.",
      );
    }

    const cutoff = ctx.now.getTime() - 30 * 86_400_000;
    const stale = ctx.tasks
      .filter(
        (t) =>
          OPEN_TASK_STATUSES.has(t.status) &&
          t.dueAt === null &&
          t.startAt === null &&
          t.createdAt.getTime() < cutoff,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, MAX_BULK_CHANGES);

    if (stale.length === 0) {
      return evaluate(
        base,
        [],
        [],
        "Nothing is stale. Every open task either has a date or is less than a month old.",
      );
    }

    return evaluate(
      {
        ...base,
        summary: `Archive ${stale.length} undated ${stale.length === 1 ? "task" : "tasks"} older than a month. They stay in your list under Archived.`,
      },
      stale.map((task) => ({
        target: "Task" as const,
        targetId: task.id,
        targetLabel: task.title,
        field: "Status",
        before: task.status,
        after: "ARCHIVED",
      })),
      stale.map((task) => ({
        op: "task.update" as const,
        id: task.id,
        data: { status: "ARCHIVED" },
      })),
    );
  },
};

/**
 * Move the tail of an oversubscribed day onto the next one.
 *
 * "The tail", not "everything", is the whole design. The finding behind this
 * action is that a day holds more than the user said they had time for, so moving
 * every task off it would relocate the oversubscription rather than resolve it —
 * and a "fix" that makes the next day worse is worse than no fix. So the day is
 * measured against the capacity the user themselves entered at onboarding, and
 * only the tasks past that line move.
 *
 * Which tasks fall past the line is decided by importance, not by list order, so
 * the day keeps its most important work and sheds the rest. Tasks with no estimate
 * count as zero: an unknown duration cannot be shown to overflow anything, and
 * guessing one would move work on the strength of a number nobody entered.
 */
const rescheduleTasks: ActionSpec = {
  label: "Spread out an oversubscribed day",
  plan(ctx, payload) {
    const base = { kind: "RESCHEDULE_TASKS", label: this.label, summary: "" };

    if (typeof payload.date !== "string" || payload.strategy !== "move_lowest_priority") {
      return evaluate(
        base,
        [],
        [],
        "This is advice about which day to plan heavy work on, not a change to make. Use the planner to move the work yourself.",
      );
    }

    const day = new Date(`${payload.date}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) {
      return evaluate(base, [], [], "That day could not be read.");
    }

    const onDay = ctx.tasks
      .filter(
        (t) =>
          OPEN_TASK_STATUSES.has(t.status) &&
          t.dueAt !== null &&
          dateOnlyLocal(t.dueAt).getTime() === dateOnlyLocal(day).getTime(),
      )
      .sort((a, b) => b.importance - a.importance || a.dueAt!.getTime() - b.dueAt!.getTime());

    if (onDay.length === 0) {
      return evaluate(
        base,
        [],
        [],
        "Nothing is due on that day any more, so there is nothing to move.",
      );
    }

    const isWeekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    const budget =
      (isWeekend
        ? ctx.profile?.availableWeekendMinutes
        : ctx.profile?.availableWeekdayMinutes) ?? DEFAULT_AVAILABLE_MINUTES;

    // Walk the day in importance order and keep what fits; the rest is the tail.
    let kept = 0;
    const moved: ActionTask[] = [];
    for (const task of onDay) {
      const cost = task.estimatedMinutes ?? 0;
      if (kept + cost <= budget) {
        kept += cost;
      } else {
        moved.push(task);
      }
    }

    if (moved.length === 0) {
      return evaluate(
        base,
        [],
        [],
        `That day already fits inside the ${formatDuration(budget)} you said you have. Nothing to move.`,
      );
    }

    const capped = moved.slice(0, MAX_BULK_CHANGES);
    const movedMinutes = capped.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
    const deferred = moved.length - capped.length;

    return evaluate(
      {
        ...base,
        summary:
          `Move ${capped.length} ${capped.length === 1 ? "task" : "tasks"}` +
          (movedMinutes > 0 ? ` (${formatDuration(movedMinutes)})` : "") +
          ` off that day to the next, so the day fits the ${formatDuration(budget)} you said you have.` +
          (deferred > 0
            ? ` ${deferred} more are over budget and stay where they are.`
            : ""),
      },
      capped.map((task) => ({
        target: "Task" as const,
        targetId: task.id,
        targetLabel: task.title,
        field: "Due",
        before: instant(task.dueAt),
        after: formatLocalWeekdayClock(shiftDays(task.dueAt!, 1)),
      })),
      capped.map((task) => ({
        op: "task.update" as const,
        id: task.id,
        data: { dueAt: shiftDays(task.dueAt!, 1) },
      })),
    );
  },
};

/**
 * Lower a habit's target to something the record can actually support.
 *
 * Steps down target value first, then difficulty. A habit already at one-per-day
 * and EASY has nowhere left to go, and saying so is more useful than inventing a
 * change that would not help.
 */
const adjustHabit: ActionSpec = {
  label: "Lower a habit target",
  plan(ctx, payload) {
    const habitId = typeof payload.habitId === "string" ? payload.habitId : "";
    const base = { kind: "ADJUST_HABIT", label: this.label, summary: "" };

    const habit = ctx.habits.find((h) => h.id === habitId);
    if (!habit) return evaluate(base, [], [], "That habit no longer exists.");

    if (habit.targetValue > 1) {
      // Round to a whole number, and never below one: a target of zero is not a
      // smaller goal, it is the absence of one.
      const next = Math.max(1, Math.round(habit.targetValue * 0.75));
      return evaluate(
        { ...base, summary: `Reduce "${habit.name}" from ${habit.targetValue} to ${next}.` },
        [
          {
            target: "Habit",
            targetId: habit.id,
            targetLabel: habit.name,
            field: "Target",
            before: String(habit.targetValue),
            after: String(next),
          },
        ],
        [{ op: "habit.update", id: habit.id, data: { targetValue: next } }],
      );
    }

    const step = DIFFICULTY_LADDER.indexOf(habit.difficulty);
    if (step > 0) {
      const next = DIFFICULTY_LADDER[step - 1]!;
      return evaluate(
        { ...base, summary: `"${habit.name}" is already at ${habit.targetValue} a day, so make it an ${next.toLowerCase()} habit instead.` },
        [
          {
            target: "Habit",
            targetId: habit.id,
            targetLabel: habit.name,
            field: "Difficulty",
            before: habit.difficulty,
            after: next,
          },
        ],
        [{ op: "habit.update", id: habit.id, data: { difficulty: next } }],
      );
    }

    return evaluate(
      base,
      [],
      [],
      `"${habit.name}" is already at one a day and marked EASY. There is nothing left to lower.`,
    );
  },
};

/** Turn on the reminder for habits that are tracked but never scheduled. */
const scheduleHabit: ActionSpec = {
  label: "Schedule habit reminders",
  plan(ctx, payload) {
    const ids = Array.isArray(payload.habitIds)
      ? payload.habitIds.filter((v): v is string => typeof v === "string")
      : [];
    const base = { kind: "SCHEDULE_HABIT", label: this.label, summary: "" };

    const off = ctx.habits
      .filter((h) => ids.includes(h.id) && h.isActive && !h.archivedAt && !h.reminderEnabled)
      .slice(0, MAX_BULK_CHANGES);

    if (off.length === 0) {
      return evaluate(
        base,
        [],
        [],
        "Those habits already have reminders, or have been paused since.",
      );
    }

    // Fall back to the habit's own preferred time, then to 9am. An arbitrary
    // constant would be worse than a stated default.
    const minuteFor = (h: ActionHabit) => h.reminderMinutes ?? h.preferredMinutes ?? 9 * 60;

    return evaluate(
      {
        ...base,
        summary: `Turn on a daily reminder for ${off.length} ${off.length === 1 ? "habit" : "habits"}, at the time each one already prefers.`,
      },
      off.map((habit) => ({
        target: "Habit" as const,
        targetId: habit.id,
        targetLabel: habit.name,
        field: "Reminder",
        before: "off",
        after: `every day at ${formatMinutesOfDay(minuteFor(habit))}`,
      })),
      off.map((habit) => ({
        op: "habit.update" as const,
        id: habit.id,
        data: { reminderEnabled: true, reminderMinutes: minuteFor(habit) },
      })),
    );
  },
};

/** Move the user's bedtime on their profile to the suggested target. */
const suggestBedtime: ActionSpec = {
  label: "Set a bedtime target",
  plan(ctx, payload) {
    const hours = typeof payload.targetHours === "number" ? payload.targetHours : null;
    const base = { kind: "SUGGEST_BEDTIME", label: this.label, summary: "" };

    if (hours === null || hours <= 0 || hours > 24) {
      return evaluate(base, [], [], "That bedtime target could not be read.");
    }
    if (!ctx.profile) {
      return evaluate(
        base,
        [],
        [],
        "You have no profile yet, so there is no bedtime to move. Finish onboarding first.",
      );
    }

    const next = Math.round(hours * 60);
    if (ctx.profile.sleepMinutes === next) {
      return evaluate(
        base,
        [],
        [],
        `Your bedtime is already set to ${formatMinutesOfDay(next)}.`,
      );
    }

    const before = ctx.profile.sleepMinutes;
    return evaluate(
      {
        ...base,
        summary: `Set your target bedtime to ${formatMinutesOfDay(next)}. The planner will stop scheduling past it.`,
      },
      [
        {
          target: "Profile",
          targetId: "profile",
          targetLabel: "Your profile",
          field: "Bedtime",
          before: before === null ? "not set" : formatMinutesOfDay(before),
          after: formatMinutesOfDay(next),
        },
      ],
      [{ op: "profile.update", data: { sleepMinutes: next } }],
    );
  },
};

/** Push a slipping goal's target date out. */
const adjustGoal: ActionSpec = {
  label: "Move a goal's target date",
  plan(ctx, payload) {
    const goalId = typeof payload.goalId === "string" ? payload.goalId : "";
    const base = { kind: "ADJUST_GOAL", label: this.label, summary: "" };

    const goal = ctx.goals.find((g) => g.id === goalId);
    if (!goal) return evaluate(base, [], [], "That goal no longer exists.");

    if (payload.suggestion !== "extend_target_date") {
      return evaluate(
        base,
        [],
        [],
        "This one asks for milestones, and milestones are yours to write. Add them on the goal and they will show up in planning.",
      );
    }
    if (goal.targetDate === null) {
      return evaluate(
        base,
        [],
        [],
        `"${goal.title}" has no target date, so there is nothing to move. Add one on the goal.`,
      );
    }

    const slipped = goal.targetDate.getTime() < ctx.now.getTime();
    if (!slipped) {
      return evaluate(
        base,
        [],
        [],
        `"${goal.title}" has not slipped yet — its target date is still ahead of you.`,
      );
    }

    const next = shiftDays(goal.targetDate, 14);
    return evaluate(
      {
        ...base,
        summary: `Move "${goal.title}" out by a fortnight, to ${formatLocalWeekdayClock(next)}.`,
      },
      [
        {
          target: "Goal",
          targetId: goal.id,
          targetLabel: goal.title,
          field: "Target date",
          before: formatLocalWeekdayClock(goal.targetDate),
          after: formatLocalWeekdayClock(next),
        },
      ],
      [{ op: "goal.update", id: goal.id, data: { targetDate: next } }],
    );
  },
};

// ---------------------------------------------------------------------------
// Advice with no writable home
// ---------------------------------------------------------------------------

/**
 * Suggestions that describe a pattern rather than a change.
 *
 * Each of these is a real finding with no row to write to. LIFEOS stores no
 * "preferred focus length", no "avoid this weekday" flag and no goal-breakdown
 * template, and inventing one to make the button work would be storing a
 * fabricated preference on the user's behalf. They are refused with a reason that
 * says where the setting actually lives, so the button is honest rather than
 * absent.
 */
const observeOnly = (kind: string, label: string, reason: string): ActionSpec => ({
  label,
  plan: (_ctx, _payload) => evaluate({ kind, label, summary: "" }, [], [], reason),
});

const SPECS: Record<string, ActionSpec> = {
  LOG_HABIT: logHabit,
  TRIAGE_OVERDUE: triageOverdue,
  ARCHIVE_STALE: archiveStale,
  RESCHEDULE_TASKS: rescheduleTasks,
  ADJUST_HABIT: adjustHabit,
  SCHEDULE_HABIT: scheduleHabit,
  SUGGEST_BEDTIME: suggestBedtime,
  ADJUST_GOAL: adjustGoal,
  SUGGEST_SHORTER_POMODOROS: observeOnly(
    "SUGGEST_SHORTER_POMODOROS",
    "Shorten focus sessions",
    "This is a length to try, not a setting LIFEOS keeps. Set the duration on the focus timer when you run one.",
  ),
  SUGGEST_FOCUS_WINDOW: observeOnly(
    "SUGGEST_FOCUS_WINDOW",
    "Focus window",
    "This is a time of day your focus is already good at, so there is nothing to change. Put a time block there on the planner.",
  ),
  BREAK_DOWN_GOAL: observeOnly(
    "BREAK_DOWN_GOAL",
    "Break down a goal",
    "Breaking a goal into tasks needs your own words, not generated ones. Add tasks to the goal and the planner will schedule them.",
  ),
};

/** Every action kind the executor understands, for display and for tests. */
export const ACTION_KINDS = Object.keys(SPECS).sort();

/** Minutes past midnight as `7:30 AM`, for reminder and bedtime values. */
export function formatMinutesOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = Math.round(minutes % 60);
  const suffix = hours < 12 ? "AM" : "PM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/**
 * Plan an action without performing it.
 *
 * The one entry point. Both the preview endpoint and the apply endpoint call
 * this, which is what guarantees the diff the user approved and the writes that
 * ran are computed the same way from the same state.
 */
export function planAction(
  ctx: ActionContext,
  kind: string | null,
  payload: unknown,
): ActionEvaluation {
  if (!kind) {
    return {
      plan: {
        kind: "",
        label: "",
        summary: "",
        applicable: false,
        reason: "This is an observation, not a suggestion with a change behind it.",
        changes: [],
      },
      writes: [],
    };
  }

  const spec = SPECS[kind];
  if (!spec) {
    return {
      plan: {
        kind,
        label: "",
        summary: "",
        applicable: false,
        reason: "LIFEOS has no automated change for this suggestion yet.",
        changes: [],
      },
      writes: [],
    };
  }

  return spec.plan(ctx, asRecord(payload));
}

/** The writes a plan implies. Convenience over `planAction(...).writes`. */
export function planWrites(
  ctx: ActionContext,
  kind: string | null,
  payload: unknown,
): ActionWrite[] {
  return planAction(ctx, kind, payload).writes;
}
