/**
 * Natural-language task capture.
 *
 * Turns a sentence typed into quick-add into a reviewable task draft. Pure and
 * server-free: the caller decides whether to persist it.
 *
 * The governing principle is that a draft is a *suggestion the user sees*, not a
 * silent mutation. Every field the parser filled in comes back with the words it
 * used to fill it, so the UI can say "I read *tomorrow at 9am* as Friday 09:00"
 * and offer a correction. A parser that guesses quietly is worse than no parser
 * at all, because a wrongly-dated task is still wrong at 3am when the deadline
 * passes unremarked.
 *
 * Nothing here is probabilistic, so `confidence` is a transparent count of how
 * much of the input was actually understood rather than a model score.
 */

import {
  extractDuration,
  extractWhen,
  stripTemporal,
  type DurationHint,
  type WhenHint,
} from "./when";
import { formatIndianDate, formatLocalWeekdayClock } from "@/lib/format/date";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type Energy = "LOW" | "MEDIUM" | "HIGH";

export interface ParsedTask {
  title: string;
  dueAt: Date | null;
  estimatedMinutes: number | null;
  priority: Priority;
  importance: number;
  urgency: number;
  energy: Energy;
  isRecurring: boolean;
  /** Human-readable trace of each decision, for the "I read this as" panel. */
  reasons: string[];
  /** Words the parser did not consume. Worth surfacing so nothing is lost. */
  leftovers: string;
  /** 0-1, from how much of the input was understood. */
  confidence: number;
}

const PRIORITY_WORDS: [RegExp, Priority][] = [
  [/\b(urgent|asap|immediately|right now|critical)\b/i, "URGENT"],
  [/\b(high[- ]priority|important|priority|critical|must)\b/i, "HIGH"],
  [/\b(low[- ]priority|someday|when free|whenever|if time|nice to have|no rush)\b/i, "LOW"],
];

/**
 * Words that mark a task as repeated.
 *
 * Only the unambiguous ones. "every day" and "each monday" describe a schedule;
 * "daily" and "weekly" are the same signal written as an adjective. Anything
 * vaguer is left to the user to set in the recurrence editor, because a wrong
 * recurrence silently generates tasks forever.
 */
const RECURRENCE_PATTERNS: [RegExp, Record<string, unknown>][] = [
  [/\bevery\s+(day|daily)\b/i, { frequency: "DAILY" }],
  [/\bevery\s+(week|weekly)\b/i, { frequency: "WEEKLY" }],
  [/\bevery\s+(month|monthly)\b/i, { frequency: "MONTHLY" }],
  [/\bevery\s+(\w+day)\b/i, { frequency: "WEEKLY", days: null }],
  [/\b(daily|weekly|monthly|yearly|annually)\b/i, { frequency: "WEEKLY" }],
];

const ENERGY_LOW = /\b(quick|tidy|organise|organize|file|sort|clean|draft|reply|skim|glance)\b/i;
const ENERGY_HIGH = /\b(deep work|write|research|design|architect|refactor|study|learn|build|implement|analyse|analyze)\b/i;

/** `call Bob tomorrow at 9am for 15m !high` -> title `Call Bob`. */
function toTitleCase(text: string): string {
  const trimmed = text.trim().replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "");
  if (!trimmed) return "";
  return trimmed
    .split(/\s+/)
    .map((word, index) => {
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      // Leave words that look like proper nouns, acronyms or code alone.
      if (word.length <= 1) return word;
      if (/^[A-Z]/.test(word)) return word;
      if (word.includes(".")) return word;
      if (/\d/.test(word)) return word;
      return word.toLowerCase();
    })
    .join(" ");
}

/**
 * Turn the local day + minutes-of-day a `WhenHint` carries into a real instant.
 *
 * The `new Date(y, m, d, h, min)` constructor is used rather than anything UTC on
 * purpose: a due time is an instant on the user's own wall clock, and see the
 * note in `@/lib/date` about why re-zoning it silently shifts the deadline.
 */
function toInstant(when: WhenHint): Date | null {
  if (!when.date) return null;
  if (when.minutes === null) {
    // An all-day deadline fires at the start of the day it names. Not midnight
    // either side of it: `date` is UTC midnight, so this is reconstructed
    // explicitly rather than reused.
    const utcMidnight = when.date;
    return new Date(
      utcMidnight.getUTCFullYear(),
      utcMidnight.getUTCMonth(),
      utcMidnight.getUTCDate(),
      9,
      0,
    );
  }
  const utcMidnight = when.date;
  return new Date(
    utcMidnight.getUTCFullYear(),
    utcMidnight.getUTCMonth(),
    utcMidnight.getUTCDate(),
    Math.floor(when.minutes / 60),
    when.minutes % 60,
  );
}

/**
 * Parse a quick-add sentence.
 *
 * `now` is injected so the caller controls the reference instant; a caller that
 * parsed three fields at slightly different moments could otherwise produce a
 * draft that straddles midnight.
 */
export function parseTaskText(text: string, now: Date = new Date()): ParsedTask {
  const reasons: string[] = [];
  const source = text.trim();

  let working = source;
  let when: WhenHint = { date: null, minutes: null, matched: null, spans: [], allDay: true };
  let duration: DurationHint = { minutes: null, matched: null };

  // Priority and recurrence are read from the whole sentence, including parts
  // that later become the title, so an explicit `!high` survives title casing.
  let priority: Priority | null = null;
  for (const [pattern, value] of PRIORITY_WORDS) {
    if (pattern.test(source)) {
      priority = value;
      reasons.push(`Read "${pattern.source.replace(/\\b|[()]/g, " ").trim()}" as ${value.toLowerCase()} priority.`);
      working = working.replace(pattern, " ");
      break;
    }
  }

  let recurrence: Record<string, unknown> | null = null;
  for (const [pattern, value] of RECURRENCE_PATTERNS) {
    if (pattern.test(source)) {
      recurrence = value;
      reasons.push("Detected a repeating pattern — check the recurrence before saving.");
      working = working.replace(pattern, " ");
      break;
    }
  }

  // Order matters: the duration is stripped first because "for 30 minutes on
  // Friday" would otherwise let the duration's "30" be read as a clock time.
  duration = extractDuration(working);
  if (duration.minutes !== null) {
    reasons.push(`Estimate of ${duration.minutes} minutes taken from "${duration.matched}".`);
  }

  when = extractWhen(working, now);
  if (when.matched) {
    const due = toInstant(when);
    if (due) {
      reasons.push(
        when.allDay
          ? `Deadline on ${formatIndianDate(due)}; no time given, so it defaults to 9:00am.`
          : `Deadline read as ${formatLocalWeekdayClock(due)}.`,
      );
    }
  }

  const leftovers = stripTemporal(working, when, duration)
    .replace(/\b(?:and|then|by|on|at|for|due|before|after|around)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:.\-–—]+|[\s,;:.\-–—]+$/g, "")
    .trim();

  const title = toTitleCase(leftovers) || toTitleCase(source);

  let energy: Energy = "MEDIUM";
  if (ENERGY_LOW.test(source)) energy = "LOW";
  else if (ENERGY_HIGH.test(source)) energy = "HIGH";
  if (energy !== "MEDIUM") {
    reasons.push(`Classified as ${energy.toLowerCase()}-energy work.`);
  }

  const priorityValue: Priority = priority ?? (dueSoon(when, now) ? "HIGH" : "MEDIUM");
  if (!priority && priorityValue === "HIGH") {
    reasons.push("Raised to high priority because the deadline is close.");
  }

  const importance = priorityValue === "URGENT" ? 5 : priorityValue === "HIGH" ? 4 : 3;
  const urgency =
    priorityValue === "URGENT" ? 5 : priorityValue === "HIGH" ? 4 : when.date ? 3 : 2;

  // Transparent, not learned: each understood signal is one point, capped at 1.
  const signals = [when.matched !== null, duration.minutes !== null, priority !== null, recurrence !== null];
  const confidence = Math.min(1, signals.filter(Boolean).length / 3);

  if (confidence < 1 && reasons.length === 0) {
    reasons.push("Nothing specific to go on — everything is left at its default.");
  }

  return {
    title,
    dueAt: toInstant(when),
    estimatedMinutes: duration.minutes,
    priority: priorityValue,
    importance,
    urgency,
    energy,
    isRecurring: recurrence !== null,
    reasons,
    leftovers,
    confidence: Math.round(confidence * 100) / 100,
  };
}

/** True when a named day is today or sooner, which nudges the priority up. */
function dueSoon(when: WhenHint, now: Date): boolean {
  if (!when.date) return false;
  const days = Math.round(
    (when.date.getTime() - new Date(now).setHours(0, 0, 0, 0)) / (24 * 60 * 60 * 1000),
  );
  return days <= 1;
}
