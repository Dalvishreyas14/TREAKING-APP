/**
 * Natural-language dates, times and durations.
 *
 * Pure and dependency-free on purpose: this is the part of the AI layer most
 * likely to be wrong in an embarrassing way, and it is far easier to be confident
 * about a function that takes `now` as a parameter and touches no database. Every
 * caller passes the same reference instant so a single input can never be parsed
 * against two different "todays" halfway through.
 *
 * Semantics: a person typing "tomorrow at 9am" means 9am on *their own wall
 * clock*, so results are built with the local `new Date(y, m, d, h, min)`
 * constructor rather than anything UTC. The extracted `date` comes back as UTC
 * midnight, which is the form a `@db.Date` column stores. Keeping both in one
 * result is deliberate — the day and the clock time are separate columns on
 * `TimeBlock` and have to be converted separately.
 *
 * When a phrase is not understood the function says so by returning null rather
 * than guessing. A quick-add that silently files a task under the wrong day is
 * worse than one that asks.
 */

import { dateOnlyLocal } from "@/lib/date";

export interface WhenHint {
  /** The calendar day meant, as UTC midnight (the `@db.Date` form). */
  date: Date | null;
  /** Minutes from local midnight when a clock time was named, else null. */
  minutes: number | null;
  /** The primary input span that produced this, for "I read this as" text. */
  matched: string | null;
  /**
   * Every span consumed, in order.
   *
   * Kept separate from `matched` because one phrase routinely supplies two facts:
   * "friday at 4pm" claims Friday *and* 4pm, and the second span has to be
   * strippable from the title too. `matched` alone would leave "4pm" stranded in
   * a task called "Draft the proposal 4pm".
   */
  spans: string[];
  /** True when only a day was named and no time was. */
  allDay: boolean;
}

const EMPTY: WhenHint = { date: null, minutes: null, matched: null, spans: [], allDay: true };

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/** Named parts of the day, in minutes from local midnight. */
const DAY_PARTS: Record<string, number> = {
  midnight: 0,
  "early morning": 6 * 60,
  morning: 9 * 60,
  "mid morning": 10 * 60,
  noon: 12 * 60,
  "mid afternoon": 14 * 60,
  afternoon: 15 * 60,
  evening: 19 * 60,
  tonight: 20 * 60,
  night: 21 * 60,
  "late night": 23 * 60,
};

const UNIT_MINUTES: Record<string, number> = {
  minute: 1,
  minutes: 1,
  min: 1,
  mins: 1,
  hour: 60,
  hours: 60,
  hr: 60,
  hrs: 60,
  h: 60,
  day: 1440,
  days: 1440,
  week: 10080,
  weeks: 10080,
};

const UNIT_ALIASES: Record<string, keyof typeof UNIT_MINUTES> = {
  m: "min",
  h: "hour",
  hr: "hr",
  hrs: "hours",
  d: "day",
  w: "week",
  min: "min",
  mins: "mins",
  minute: "minute",
  minutes: "minutes",
  hour: "hour",
  hours: "hours",
  day: "day",
  days: "days",
  week: "week",
  weeks: "weeks",
};

/** UTC midnight of the calendar day `offset` days from the day containing `now`. */
function localDayAsDate(now: Date, offset: number): Date {
  return dateOnlyLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
}

/**
 * Resolve a written unit ("m", "hrs", "weeks") to minutes, or 0 when unknown.
 *
 * A single funnel rather than repeated alias lookups at each call site: the
 * patterns above already constrain the unit to a known set, so an unknown value
 * means the pattern and the table have drifted apart, and 0 makes that visible as
 * a dropped match instead of a silent `NaN` propagating into a date.
 */
function unitMinutes(name: string | undefined): number {
  if (!name) return 0;
  const resolved = UNIT_ALIASES[name] ?? name;
  return UNIT_MINUTES[resolved] ?? 0;
}

/**
 * Parse a clock time out of a span such as "9am", "14:30", "at 5", "3.30pm".
 *
 * A bare number is only read as a clock time when it is small enough to be one
 * (1-12 without a meridiem, 0-23 with one) or when an explicit `at` precedes it.
 * Without that guard "finish 3 problems" would quietly become a 3am deadline.
 */
function parseClockTime(source: string): { minutes: number; matched: string } | null {
  const match = /\b(?:at\s+|@\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i.exec(source);
  if (!match) return null;

  const hasMeridiem = Boolean(match[3]);
  const precededByAt = /\bat\s+$/i.test(match[0]);
  if (!hasMeridiem && !precededByAt && !match[2]) return null;

  const rawHour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (rawHour > 24 || minute > 59) return null;

  let hour = rawHour;
  if (hasMeridiem) {
    const isPm = /^p/i.test(match[3]!);
    // 12am is midnight and 12pm is noon; everything else shifts by 12.
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }
  if (hour > 23) return null;

  return { minutes: hour * 60 + minute, matched: match[0].trim() };
}

/**
 * Read a time of day out of a span that may also name a date.
 *
 * Split out from `extractWhen` because the two are independent: "friday" fixes
 * the day and "at 4pm" fixes the hour, and either can appear without the other.
 * A clock time is only considered once the date has been settled, so the
 * "4" in "25/03" is never mistaken for 4am.
 */
function readClockMinutes(lower: string): { minutes: number; matched: string } | null {
  for (const [part, partMinutes] of Object.entries(DAY_PARTS)) {
    if (new RegExp(`\\b${part}\\b`).test(lower)) {
      return { minutes: partMinutes, matched: part };
    }
  }
  return parseClockTime(lower);
}

/**
 * Read the day and, where present, the time, out of free text.
 *
 * Only the *first* temporal phrase counts. "Call Sam tomorrow then book the
 * dentist next week" is one task with an ambiguous deadline, and silently picking
 * the second one would be a guess dressed up as a feature.
 */
export function extractWhen(text: string, now: Date = new Date()): WhenHint {
  const lower = text.toLowerCase();
  let date: Date | null = null;
  let minutes: number | null = null;
  let matched: string | null = null;
  const spans: string[] = [];

  const claim = (found: Date | null, foundMinutes: number | null, span: string | null) => {
    if (matched !== null) return false;
    date = found;
    minutes = foundMinutes;
    matched = span;
    if (span) spans.push(span);
    return true;
  };

  // --- absolute, unambiguous forms first -------------------------------------
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime())) claim(dateOnlyLocal(d), null, iso[0]);
  }

  if (matched === null) {
    const slashed = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower);
    if (slashed) {
      const a = Number(slashed[1]);
      const b = Number(slashed[2]);
      // The order is only knowable when one number cannot be a month. 03/25 and
      // 25/03 both appear in the wild, and reading them the same way would file
      // half the deadlines in the wrong month. When both are <= 12 the input is
      // genuinely ambiguous, so it is left for the user to confirm.
      const dayFirst = a > 12;
      const monthFirst = b > 12;
      if (dayFirst || monthFirst) {
        const dayNumber = dayFirst ? a : b;
        const monthNumber = dayFirst ? b : a;
        const rawYear = slashed[3] ? Number(slashed[3]) : now.getFullYear();
        const year = rawYear < 100 ? 2000 + rawYear : rawYear;
        const d = new Date(year, monthNumber - 1, dayNumber);
        if (!Number.isNaN(d.getTime()) && d.getMonth() === monthNumber - 1 && d.getDate() === dayNumber) {
          claim(dateOnlyLocal(d), null, slashed[0]);
        }
      }
    }
  }

  if (matched === null) {
    const monthName = new RegExp(
      `\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    ).exec(lower);
    if (monthName) {
      const monthIndex = MONTHS.indexOf(monthName[1] as (typeof MONTHS)[number]);
      const year = monthName[3] ? Number(monthName[3]) : now.getFullYear();
      const d = new Date(year, monthIndex, Number(monthName[2]));
      if (!Number.isNaN(d.getTime()) && d.getDate() === Number(monthName[2])) {
        claim(dateOnlyLocal(d), null, monthName[0]);
      }
    }
  }

  // --- relative offsets ------------------------------------------------------
  if (matched === null) {
    const relative = /\bin\s+(\d{1,3})\s*(minute|minutes|min|hour|hours|hr|hrs|day|days|week|weeks)\b/.exec(
      lower,
    );
    const unit = unitMinutes(relative?.[2]);
    if (relative && unit > 0) {
      const deltaMs = Number(relative[1]) * unit * 60_000;
      const target = new Date(now.getTime() + deltaMs);
      // An offset long enough to cross midnight names a day, not an alarm time.
      if (deltaMs >= 1440 * 60_000) {
        claim(dateOnlyLocal(target), null, relative[0]);
      } else {
        const local = new Date(target);
        claim(dateOnlyLocal(local), local.getHours() * 60 + local.getMinutes(), relative[0]);
      }
    }
  }

  if (matched === null) {
    const plainOffset = /\b(\d{1,3})\s*(minute|minutes|min|hour|hours|hr|hrs)\s+from\s+now\b/.exec(lower);
    const unit = unitMinutes(plainOffset?.[2]);
    if (plainOffset && unit > 0) {
      const target = new Date(now.getTime() + Number(plainOffset[1]) * unit * 60_000);
      claim(dateOnlyLocal(target), target.getHours() * 60 + target.getMinutes(), plainOffset[0]);
    }
  }

  // --- named days ------------------------------------------------------------
  if (matched === null) {
    const offsets: [RegExp, number][] = [
      [/\bday after tomorrow\b/, 2],
      [/\b(\d+)\s+days?\s+from\s+now\b/, -1],
      [/\btomorrow\b/, 1],
      [/\btonight\b/, 0],
      [/\btoday\b/, 0],
      [/\bthis week\b/, 0],
      [/\bnext week\b/, 7],
      [/\bend of week\b|\beow\b/, 0],
      [/\bweekend\b/, 0],
    ];

    for (const [pattern, offset] of offsets) {
      const found = pattern.exec(lower);
      const span = found?.[0];
      if (!found || span === undefined) continue;

      if (offset === -1) {
        const days = Number(found[1]);
        claim(localDayAsDate(now, days), null, span);
        break;
      }

      let day = localDayAsDate(now, offset);
      if (pattern.source.includes("eow") || pattern.source.includes("this week")) {
        day = localDayAsDate(now, 7 - ((now.getDay() + 6) % 7) - 1);
      }
      if (pattern.source.includes("weekend")) {
        const toSaturday = (6 - now.getDay() + 7) % 7;
        day = localDayAsDate(now, toSaturday);
      }

      const partMinutes = /\btonight\b/.test(span) ? (DAY_PARTS.tonight ?? null) : null;
      claim(day, partMinutes, span);
      break;
    }
  }

  if (matched === null) {
    const weekday = new RegExp(`\\b(next\\s+)?(${WEEKDAYS.join("|")})\\b`).exec(lower);
    if (weekday) {
      const target = WEEKDAYS.indexOf(weekday[2] as (typeof WEEKDAYS)[number]);
      const isNext = Boolean(weekday[1]);
      let delta = (target - now.getDay() + 7) % 7;
      // "Monday" said on a Monday means today, not a week out; "next Monday"
      // always means the following one.
      if (delta === 0 && !isNext) {
        claim(localDayAsDate(now, 0), null, weekday[0]);
        return { date, minutes, matched, spans, allDay: true };
      }
      if (isNext) delta = delta === 0 ? 7 : delta;
      claim(localDayAsDate(now, delta), null, weekday[0]);
    }
  }

  // --- times of day ----------------------------------------------------------
  if (matched !== null) {
    // A day was named with no clock time of its own. Attach a time if the text
    // has one: "review friday at 4pm" names a day *and* an hour, and returning
    // an all-day deadline for it would be a real answer to the wrong question.
    if (minutes === null) {
      const clock = readClockMinutes(lower);
      if (clock) {
        minutes = clock.minutes;
        spans.push(clock.matched);
      }
    }
    return { date, minutes, matched, spans, allDay: minutes === null };
  }

  const clock = readClockMinutes(lower);
  if (clock) {
    return {
      date: dateOnlyLocal(now),
      minutes: clock.minutes,
      matched: clock.matched,
      spans: [clock.matched],
      allDay: false,
    };
  }

  return EMPTY;
}

export interface DurationHint {
  minutes: number | null;
  matched: string | null;
}

/**
 * Read an effort estimate out of free text.
 *
 * Recognises both the "45m" shorthand and the "for about an hour" sentence, since
 * a duration is very often written as a trailing aside rather than a number.
 */
export function extractDuration(text: string): DurationHint {
  const lower = text.toLowerCase();

  const compact = /\b(\d{1,4})\s*(m|min|mins|h|hr|hrs|d)\b/.exec(lower);
  const compactUnit = unitMinutes(compact?.[2]);
  if (compact && compactUnit >= 1) {
    const total = Number(compact[1]) * compactUnit;
    if (total >= 1 && total <= 1440) {
      return { minutes: total, matched: compact[0] };
    }
  }

  const spelled = /\b(\d{1,4})\s+(minute|minutes|hour|hours|hr|hrs)\b/.exec(lower);
  const spelledUnit = unitMinutes(spelled?.[2]);
  if (spelled && spelledUnit >= 1) {
    const total = Number(spelled[1]) * spelledUnit;
    if (total >= 1 && total <= 1440) {
      return { minutes: total, matched: spelled[0] };
    }
  }

  if (/\bhalf an hour\b|\b30 minutes\b/.test(lower)) return { minutes: 30, matched: "half an hour" };
  if (/\ban hour and a half\b|\b90 minutes\b/.test(lower)) return { minutes: 90, matched: "an hour and a half" };
  if (/\ban hour\b|\bone hour\b|\b1 hour\b/.test(lower)) return { minutes: 60, matched: "an hour" };

  return { minutes: null, matched: null };
}

/**
 * Remove the spans `extractWhen` and `extractDuration` consumed, so the leftover
 * can be used as a task title.
 *
 * Only *claimed* spans are stripped, which keeps the two functions honest: if the
 * parser did not understand something, that text is still part of the title and
 * the user can see it and correct the field themselves.
 */
export function stripTemporal(text: string, ...hints: (WhenHint | DurationHint)[]): string {
  let out = text;
  for (const hint of hints) {
    // A `WhenHint` can have consumed several spans; a `DurationHint` only one.
    const spans = "spans" in hint && hint.spans.length > 0 ? hint.spans : [hint.matched ?? ""];
    for (const span of spans) {
      if (!span) continue;
      out = out.replace(new RegExp(span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
    }
  }
  return out.replace(/\s{2,}/g, " ").trim();
}
