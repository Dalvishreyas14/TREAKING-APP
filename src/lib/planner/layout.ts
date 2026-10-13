/**
 * Planner geometry.
 *
 * Pure functions over minute offsets from midnight. No React, no dates, no
 * database — the time-of-day arithmetic is separated out precisely so it can be
 * tested exhaustively, because "is this the same day" and "do these two blocks
 * clash" are the two questions the planner is judged on and both are easy to get
 * subtly wrong in a component file.
 *
 * Blocks arrive here as minutes-from-midnight in the *user's local wall clock*,
 * not as timestamps. Timestamps would drag the server's timezone into the
 * question of what "09:00" means, and a day view whose columns disagree with the
 * numbers printed inside them is worse than no planner at all.
 */

/** Smallest block the planner will lay out, in minutes. */
export const MIN_BLOCK_MINUTES = 5;

/** Largest single block, in minutes. A day is 1440; this is a "don't do that" ceiling. */
export const MAX_BLOCK_MINUTES = 12 * 60;

/** The planner renders a 06:00-24:00 window, which is when a day is actually planned. */
export const DAY_START_MINUTES = 6 * 60;

/**
 * Where a "schedule this" action should start looking.
 *
 * The window opens at 06:00, but offering someone 06:00 for a task they just
 * asked to schedule is not helpful — it is technically the first free slot and
 * practically a wrong answer. Callers that want a realistic default (the
 * create form, the unscheduled tray) pass this; callers that genuinely want the
 * whole day pass `DAY_START_MINUTES` and say so.
 */
export const WORKDAY_START_MINUTES = 9 * 60;

/**
 * Minutes from local midnight.
 *
 * Returns a value outside 0-1440 for instants on the far side of midnight, and
 * that is deliberate: the caller decides whether to clamp or reject rather than
 * having a range error thrown from inside a layout pass.
 */
export function minutesFromMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** `9:05 AM`, `1:30 PM`, `12:00 AM` — 12-hour clock with an AM/PM suffix. */
export function formatClock(minutes: number): string {
  const clamped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  const suffix = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * `450` -> `"07:30"`, the wire format a native `<input type="time">` speaks.
 *
 * Values outside a single day are clamped rather than wrapped: this feeds a
 * picker, and `"25:30"` is not a time the browser can render.
 */
export function toTimeValue(minutes: number): string {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), 1439);
  const h = String(Math.floor(clamped / 60)).padStart(2, "0");
  const m = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** `"07:30"` -> `450`, or `null` when the picker is empty or malformed. */
export function fromTimeValue(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** `1h 30m`, `45m`, `2h` — for durations in lists. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Snap to the nearest quarter hour, which is as precise as manual planning gets. */
export function snapToQuarter(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

/**
 * Do two blocks clash?
 *
 * Half-open intervals: a block ending at 10:00 and one starting at 10:00 do not
 * overlap. That is what makes back-to-back scheduling work, and it is why this
 * is `aStart < bEnd && bStart < aEnd` rather than `<=`. Getting this wrong makes
 * a full day of consecutive blocks impossible to save.
 */
export function overlaps(
  a: { startMinutes: number; endMinutes: number },
  b: { startMinutes: number; endMinutes: number },
): boolean {
  /**
   * A block with no duration is an empty interval and can never overlap
   * anything. Without this guard the half-open comparison below reports a
   * zero-length block as clashing with every block that contains its start —
   * which would let one malformed row block an entire day.
   */
  if (a.endMinutes <= a.startMinutes || b.endMinutes <= b.startMinutes) return false;
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

/** The first block that clashes with `candidate`, ignoring `ignoreId`. */
export function findConflict<T extends { id: string; startMinutes: number; endMinutes: number }>(
  candidate: { startMinutes: number; endMinutes: number },
  blocks: readonly T[],
  ignoreId?: string,
): T | undefined {
  return blocks.find(
    (b) => b.id !== ignoreId && overlaps(candidate, b),
  );
}

export interface PositionedBlock {
  /** 0-based column among blocks that share this block's time range. */
  column: number;
  /** How many columns that overlap group is split into. */
  columnCount: number;
  /** Top offset from the start of the day window, in minutes. */
  topMinutes: number;
  heightMinutes: number;
}

/**
 * Assign each block a column so concurrent blocks sit side by side instead of
 * stacking on top of each other.
 *
 * This is the standard interval-partitioning pass: sweep in start order, and a
 * block takes the first column whose last block has already ended. Counting the
 * columns in the group is what lets a lone block reclaim the full width, so a
 * day with one overlap looks like two half-width blocks rather than two narrow
 * ones floating in a wide empty row.
 *
 * Existing data can overlap — the column count is derived from reality rather
 * than assumed to be 1, because refusing to render a saved block would be a
 * worse failure than drawing it narrower.
 */
export function layoutColumns<
  T extends { id: string; startMinutes: number; endMinutes: number },
>(blocks: readonly T[]): Map<string, PositionedBlock> {
  const result = new Map<string, PositionedBlock>();
  if (blocks.length === 0) return result;

  const sorted = [...blocks].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
  );

  /** Last end-minute seen in each column, reused across the whole sweep. */
  const columnEnds: number[] = [];
  const assignments: { block: T; column: number }[] = [];

  for (const block of sorted) {
    let column = columnEnds.findIndex((end) => end <= block.startMinutes);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(block.endMinutes);
    } else {
      columnEnds[column] = block.endMinutes;
    }
    assignments.push({ block, column });
  }

  /**
   * A block's group is the run of assignments from the first one that can still
   * overlap it to the last one that starts before it ends. Scanning the full
   * assignment list is O(n²) on a day of blocks, which is at most a few hundred
   * rows — cheaper than maintaining an interval tree, and far easier to verify.
   *
   * `consumed` matters: without it the loop re-walks a block that a previous
   * group already claimed and overwrites its column count with a narrower one,
   * so two overlapping blocks both end up reported as full width and render on
   * top of each other.
   */
  const consumed = new Set<number>();
  for (let i = 0; i < assignments.length; i += 1) {
    if (consumed.has(i)) continue;
    const current = assignments[i]!;
    let last = i;
    for (let j = i + 1; j < assignments.length; j += 1) {
      if (assignments[j]!.block.startMinutes < current.block.endMinutes) last = j;
      else break;
    }
    const columnCount = last - i + 1;

    for (let k = i; k <= last; k += 1) {
      consumed.add(k);
      const { block, column } = assignments[k]!;
      result.set(block.id, {
        column,
        columnCount,
        topMinutes: Math.max(block.startMinutes - DAY_START_MINUTES, 0),
        heightMinutes: Math.max(block.endMinutes - block.startMinutes, MIN_BLOCK_MINUTES),
      });
    }
  }

  return result;
}

/**
 * Candidate start times for a block of `durationMinutes` that fits without
 * clashing.
 *
 * This is what makes "schedule this task" useful rather than a coin flip. The
 * obvious default — start at 09:00 — collides with the first meeting on most
 * days and pushes the user into a conflict dialog to discover what is already
 * booked, which is exactly the manual work the planner is meant to remove.
 *
 * Searched from the top of the window downward and snapped to the quarter hour,
 * so the answer is the earliest realistic slot. Pass `afterMinutes` to ask for
 * the next free slot from a given point instead, which is how the create form
 * offers to continue a day rather than restart it.
 */
export function findFreeSlots(
  blocks: readonly { startMinutes: number; endMinutes: number }[],
  durationMinutes: number,
  options: { fromMinutes?: number; toMinutes?: number } = {},
): number[] {
  const from = Math.max(options.fromMinutes ?? DAY_START_MINUTES, 0);
  const to = Math.min(options.toMinutes ?? 1440, 1440);
  const busy = blocks
    .map((b) => [Math.max(b.startMinutes, 0), Math.min(b.endMinutes, 1440)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  const slots: number[] = [];
  // Stepping the whole window in one pass keeps this O(n) in minutes, which is
  // 1440 at worst and needs no interval bookkeeping.
  for (let t = snapToQuarter(from); t + durationMinutes <= to; t += 15) {
    const candidate = { startMinutes: t, endMinutes: t + durationMinutes };
    if (!busy.some(([s, e]) => overlaps(candidate, { startMinutes: s, endMinutes: e }))) {
      slots.push(t);
    }
  }
  return slots;
}

/** The earliest free slot, or null when the day has no room left. */
export function firstFreeSlot(
  blocks: readonly { startMinutes: number; endMinutes: number }[],
  durationMinutes: number,
  options: { fromMinutes?: number; toMinutes?: number } = {},
): number | null {
  return findFreeSlots(blocks, durationMinutes, options)[0] ?? null;
}

export interface DayTotals {
  /** Minutes covered by blocks. Overlapping blocks are counted once each. */
  plannedMinutes: number;
  /** Sum of every block's duration, which exceeds `plannedMinutes` when blocks clash. */
  bookedMinutes: number;
  /** Blocks scheduled after the day window opened. */
  blockCount: number;
  /** `plannedMinutes` / 1440, as a percentage. */
  coveragePercent: number;
  /** Longest run of unscheduled minutes inside the day window, in minutes. */
  longestGapMinutes: number;
}

/**
 * How the day actually adds up.
 *
 * `plannedMinutes` de-duplicates overlaps by walking a minute set rather than
 * summing durations, so three overlapping blocks do not report 300 minutes of a
 * 1440-minute day. `bookedMinutes` is kept alongside it because "you have
 * booked 5h 30m but only 3h of your day is covered" is a genuinely useful thing
 * to tell someone — it is what tells them they have double-booked themselves.
 */
export function dayTotals(
  blocks: readonly { startMinutes: number; endMinutes: number }[],
): DayTotals {
  const covered = new Set<number>();
  let bookedMinutes = 0;

  for (const block of blocks) {
    bookedMinutes += Math.max(block.endMinutes - block.startMinutes, 0);
    // Bounded so a corrupt or absurd end time cannot allocate a huge set.
    const from = Math.max(Math.floor(block.startMinutes), 0);
    const to = Math.min(Math.ceil(block.endMinutes), 1440);
    for (let m = from; m < to; m += 1) covered.add(m);
  }

  const plannedMinutes = covered.size;

  let longestGapMinutes = 0;
  let runStart: number | null = DAY_START_MINUTES;
  const minutes = [...covered].sort((a, b) => a - b);
  for (const minute of minutes) {
    if (runStart !== null && minute - runStart > 0) {
      longestGapMinutes = Math.max(longestGapMinutes, minute - runStart);
    }
    runStart = minute + 1;
  }
  if (runStart !== null) longestGapMinutes = Math.max(longestGapMinutes, 1440 - runStart);

  return {
    plannedMinutes,
    bookedMinutes,
    blockCount: blocks.length,
    coveragePercent: Math.round((plannedMinutes / 1440) * 100),
    longestGapMinutes: Math.max(longestGapMinutes, 0),
  };
}
