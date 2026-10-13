/**
 * Reminder recurrence, as pure functions.
 *
 * This app has no worker process and no cron, so a reminder does not "fire" on
 * its own - it fires when something asks whether it is due, which happens on
 * every read of the notification list. That makes this module the whole
 * scheduling engine, and it is pure on purpose: every rule worth arguing about
 * is a function of two dates and can be tested without a database.
 *
 * The `recurrence` column is `Json` rather than a set of columns because the
 * shapes are open-ended, and a `Json` column means an unrecognised rule
 * degrades to "does not repeat" instead of a migration. Nothing in the schema
 * guarantees the value parses, so every entry point goes through
 * `parseRecurrence` rather than casting.
 *
 * A reminder is one-shot when it has no rule. One-shot reminders are *disabled*
 * after they are delivered rather than deleted: the row is the only record that
 * the user once wanted to be told something at this time, and keeping it is what
 * makes the list of past reminders legible.
 */

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY";

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** Must be >= 1. "Every 2 days" is `DAILY` with interval 2. */
  interval: number;
  /** 0 = Sunday ... 6 = Saturday. Only consulted for WEEKLY. */
  byWeekday?: number[];
}

const FREQS: RecurrenceFreq[] = ["DAILY", "WEEKLY", "MONTHLY"];

/**
 * Reads a `recurrence` JSON value, or returns null when it is absent or does not
 * describe a rule this app can schedule. Null is a valid answer, not a failure:
 * a corrupt rule should degrade to a one-shot reminder that still fires, never
 * to a reminder that silently never fires.
 */
export function parseRecurrence(value: unknown): RecurrenceRule | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const freq = raw.freq;
  if (typeof freq !== "string" || !FREQS.includes(freq as RecurrenceFreq)) return null;

  const interval = raw.interval === undefined ? 1 : raw.interval;
  if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1) return null;
  // A cap on the interval keeps the next-occurrence scan bounded. Five years is
  // longer than any reminder anyone sets by hand.
  if (interval > 1825) return null;

  const byWeekday = Array.isArray(raw.byWeekday)
    ? [...new Set(raw.byWeekday.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6))]
    : undefined;

  const rule: RecurrenceRule = { freq: freq as RecurrenceFreq, interval };
  if (freq === "WEEKLY") {
    // WEEKLY without weekdays means "the same weekday as the first time", which
    // is what `nextOccurrence` needs to know, so the anchor is carried through.
    rule.byWeekday = byWeekday && byWeekday.length > 0 ? [...byWeekday].sort((a, b) => a - b) : undefined;
  }
  return rule;
}

/** Days in a month without the overflow trickery of `new Date(y, m + 1, 0)`. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * The first occurrence of `rule` strictly after `after`.
 *
 * Returns null only when a WEEKLY rule lists no weekday, which `parseRecurrence`
 * can produce for hand-written JSON; the caller treats that as "stop repeating"
 * rather than looping.
 *
 * Works in local time on purpose. A reminder set for 07:00 must stay at 07:00
 * across a DST boundary, and doing the arithmetic on UTC instants is exactly how
 * reminders end up firing at 06:00 or 08:00 twice a year.
 */
export function nextOccurrence(rule: RecurrenceRule, after: Date): Date | null {
  const { freq, interval } = rule;

  if (freq === "DAILY") {
    const next = new Date(after);
    next.setDate(next.getDate() + interval);
    next.setHours(after.getHours(), after.getMinutes(), 0, 0);
    return next;
  }

  if (freq === "MONTHLY") {
    const next = new Date(after);
    const targetMonth = next.getMonth() + interval;
    const year = next.getFullYear() + Math.floor(targetMonth / 12);
    const month = ((targetMonth % 12) + 12) % 12;
    next.setFullYear(year, month, 1);
    // Clamp rather than overflow. "Every month" anchored on the 31st should be
    // the 28th in February, not the 2nd or 3rd of March.
    next.setDate(Math.min(after.getDate(), daysInMonth(year, month)));
    next.setHours(after.getHours(), after.getMinutes(), 0, 0);
    return next;
  }

  // WEEKLY. A rule with no weekday means the weekday of `after` itself.
  //
  // `interval` counts *weeks*, so this cannot be a day-by-day scan for the first
  // match - "every other Tuesday" would then fire a day later. The anchor's own
  // week is week 0, and the weeks that may contain an occurrence are 0, N, 2N,
  // ... so the search walks whole week blocks and picks the first wanted weekday
  // inside a block that is a whole week after the current position. Week 0 is
  // still searched, because a rule with several weekdays legitimately fires again
  // later in the same week.
  const wanted = new Set(rule.byWeekday ?? [after.getDay()]);
  const blockStart = startOfDay(after);
  const blockWeeks = Math.max(1, interval);
  // Week 0 is the anchor's own week. A single-week rule may fire again later in
  // it - that is the only way a Mon/Wed/Fri reminder gets its Wednesday. A
  // multi-week rule may not, because block 0 is the block that was just used to
  // set the reminder; searching it would fire "every other Monday" the very next
  // day.
  const firstBlock = blockWeeks === 1 ? 0 : blockWeeks;

  for (let week = firstBlock; week < blockWeeks + firstBlock + blockWeeks; week += blockWeeks) {
    const first = new Date(blockStart);
    first.setDate(first.getDate() + week * 7);

    for (let day = 0; day < 7; day += 1) {
      const candidate = new Date(first);
      candidate.setDate(candidate.getDate() + day);
      candidate.setHours(after.getHours(), after.getMinutes(), 0, 0);
      if (candidate <= after) continue;
      if (wanted.has(candidate.getDay())) return candidate;
    }
  }
  return null;
}

/** Midnight, local, on the same day. The unit weeks are counted in. */
function startOfDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * The first occurrence after `now`, skipping over any that were missed.
 *
 * Advancing one occurrence at a time from `now` would be wrong twice over. It
 * would anchor the new time-of-day on the moment of delivery, so a 07:00
 * reminder first read at noon would quietly become a noon reminder, and for a
 * monthly rule it would re-align the day of the month. So this walks forward
 * from the reminder's own `scheduledFor` instead, which preserves both the
 * time-of-day and the day-of-month alignment, and stops at the first slot past
 * `now`.
 *
 * A reminder missed for a month therefore delivers once and reschedules, rather
 * than replaying every slot it slept through.
 */
export function nextFutureOccurrence(rule: RecurrenceRule, scheduledFor: Date, now: Date): Date | null {
  let cursor: Date | null = scheduledFor;
  // Bounded so a hand-written rule cannot spin. 400 steps covers a daily
  // reminder left unread for over a year.
  for (let i = 0; i < 400 && cursor && cursor <= now; i += 1) {
    cursor = nextOccurrence(rule, cursor);
  }
  return cursor && cursor > now ? cursor : null;
}

export interface ReminderLike {
  enabled: boolean;
  scheduledFor: Date;
  lastSentAt: Date | null;
}

/**
 * Whether a reminder should produce a notification right now.
 *
 * The `lastSentAt` comparison against `scheduledFor` is the idempotency guard.
 * `sentAt` would not work: it records *when the user was last told*, which for a
 * recurring reminder is the previous slot, not the current one. Dispatch is
 * reached from every read of the notification list and from page loads, so
 * without this guard a single reminder would be delivered on every request.
 */
export function isDue(reminder: ReminderLike, now: Date): boolean {
  if (!reminder.enabled) return false;
  if (reminder.scheduledFor > now) return false;
  if (!reminder.lastSentAt) return true;
  return reminder.lastSentAt < reminder.scheduledFor;
}

export interface AdvanceResult {
  scheduledFor: Date;
  lastSentAt: Date;
  sentAt: Date | null;
  enabled: boolean;
}

/**
 * The row to write after delivering a reminder.
 *
 * A repeating reminder keeps its date and moves it forward to the next future
 * slot. A one-shot, or a repeat whose rule can no longer be resolved, is
 * disabled so it cannot re-fire.
 */
export function advance(
  scheduledFor: Date,
  recurrence: unknown,
  now: Date,
): AdvanceResult {
  const rule = parseRecurrence(recurrence);
  const next = rule ? nextFutureOccurrence(rule, scheduledFor, now) : null;
  return {
    scheduledFor: next ?? scheduledFor,
    lastSentAt: now,
    // `sentAt` is the final delivery: set only when there is no next occurrence.
    sentAt: next ? null : now,
    enabled: next !== null,
  };
}

/** Human-readable form for the reminder list, matching the create form's options. */
export function describeRecurrence(recurrence: unknown): string {
  const rule = parseRecurrence(recurrence);
  if (!rule) return "Once";
  if (rule.interval === 1 && (!rule.byWeekday || rule.byWeekday.length === 0)) {
    return rule.freq === "DAILY" ? "Daily" : rule.freq === "WEEKLY" ? "Weekly" : "Monthly";
  }
  const times = rule.interval === 1 ? "Every" : `Every ${rule.interval}`;
  if (rule.freq === "DAILY") return `${times} day${rule.interval === 1 ? "" : "s"}`;
  if (rule.freq === "MONTHLY") return `${times} month${rule.interval === 1 ? "" : "s"}`;

  const names = (rule.byWeekday ?? []).map((d) => WEEKDAY_NAMES[d]);
  if (names.length === 0) return "Weekly";
  if (names.length === 7) return "Every day";
  return `${names.join(", ")}`;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
