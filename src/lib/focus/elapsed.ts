/**
 * Elapsed focus time, with pauses taken into account.
 *
 * The number that matters is not "how long has the timer been open" but "how
 * long was the user actually working". A timer left running on a desk while
 * someone makes tea would otherwise report twenty minutes of study that never
 * happened, and that number ends up in the study session and the habit log.
 *
 * Everything is derived from server-stamped instants. The client never sends
 * a duration, because a client that asserts its own elapsed time is a client
 * that can lie about it - and this number feeds XP, the analytics screen and
 * a habit's streak.
 *
 * The arithmetic:
 *
 *     gross   = now - startedAt
 *     paused  = pausedSeconds + (pausedAt ? now - pausedAt : 0)
 *     elapsed = gross - paused
 *
 * A session that was never paused has `pausedSeconds = 0` and `pausedAt =
 * null`, so the result is exactly what it always was.
 */

export interface ElapsedInput {
  startedAt: Date;
  /** How much time the session has already spent paused. */
  pausedSeconds: number;
  /** When the current pause began, or null when the session is running. */
  pausedAt: Date | null;
}

/** Seconds of focus time between `startedAt` and `now`, excluding pauses. */
export function elapsedFocusSeconds(input: ElapsedInput, now: Date = new Date()): number {
  const gross = Math.max(0, Math.round((now.getTime() - input.startedAt.getTime()) / 1000));

  const currentPause = input.pausedAt
    ? Math.max(0, Math.round((now.getTime() - input.pausedAt.getTime()) / 1000))
    : 0;

  return Math.max(0, gross - input.pausedSeconds - currentPause);
}
