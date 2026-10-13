import { formatDuration } from "@/lib/planner/layout";

/**
 * Focus time in seconds, as the largest unit that still reads as a number.
 *
 * Focus is stored in seconds but almost never rendered in seconds, and the
 * conversion happens in enough places (task rows, project cards, dashboard
 * panels) that doing it inline is how "1m focused" ends up meaning one session
 * on one screen and one minute on another.
 *
 * Below a minute it says "<1m" rather than "0m". A session that was started and
 * abandoned still happened, and rendering it as zero is the same error as
 * rendering a task nobody has touched: the two become indistinguishable.
 */
export function formatFocusSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const minutes = seconds / 60;
  if (minutes < 1) return "<1m";
  return formatDuration(minutes);
}
