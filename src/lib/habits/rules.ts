/**
 * How a habit decides whether it is done.
 *
 * These rules were previously inline in the habit log route and mirrored by
 * hand in the client tracker. The study timetable needs them too - finishing a
 * scheduled session has to update a linked habit *under that habit's own
 * rules*, not under rules invented by the timetable - so they live here once.
 *
 * The module is deliberately free of the Prisma client: the rule is a pure
 * function of the habit's type and target, and both the server route and the
 * optimistic client UI need it.
 */

/** The habit types this module understands. Matches the `HabitType` enum. */
export type HabitRuleType = "BOOLEAN" | "COUNT" | "DURATION" | "DISTANCE" | "QUANTITY";

/**
 * The value a habit log should store for a requested amount.
 *
 * A BOOLEAN habit is a yes or a no, so any positive request collapses to 1 and
 * anything else to 0. Every other type keeps the number, because "45 of 45
 * minutes" and "20 of 20 pages" are the same kind of claim.
 */
export function habitLogValue(type: HabitRuleType, requested: number): number {
  if (type === "BOOLEAN") return requested > 0 ? 1 : 0;
  return requested;
}

/**
 * Whether a log of `value` counts as the habit being done.
 *
 * A BOOLEAN habit is done at any value above zero. Every other type is done
 * when the value reaches its target. A target of zero or less is treated as
 * one, because a habit with a target of zero would otherwise be impossible to
 * complete, and a habit nobody can complete is a rule bug rather than a
 * statement of intent.
 */
export function habitIsComplete(
  type: HabitRuleType,
  value: number,
  targetValue: number,
): boolean {
  if (type === "BOOLEAN") return value > 0;
  const target = targetValue > 0 ? targetValue : 1;
  return value >= target;
}

/**
 * The completion state for a log, given the habit's type and target.
 *
 * The one place the two rules above are combined, so every caller gets the
 * same pair of number and verdict for the same inputs.
 */
export function habitCompletion(
  type: HabitRuleType,
  requested: number,
  targetValue: number,
): { value: number; completed: boolean } {
  const value = habitLogValue(type, requested);
  return { value, completed: habitIsComplete(type, value, targetValue) };
}
