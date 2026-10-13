import { formatDuration, formatMinutes, mean, pct, round, utcWeekday, weekdayName } from "./stats";
import { addDaysUtc, dateOnly, daysBetween } from "@/lib/date";
import { formatIndianDate, formatLocalWeekdayClock } from "@/lib/format/date";
import { parseTaskText } from "./task-parser";
import { availableMinutes } from "./insights";
import type { LifeSnapshot } from "./snapshot";

/**
 * The assistant.
 *
 * A retrieval-and-template system, not a language model. It works by
 * classifying the question into one of a fixed set of intents, then answering it
 * from the snapshot with arithmetic and a sentence built around the result.
 *
 * The reason it is built this way is not a shortage of budget. It is that every
 * answer here has to be true. A model asked "how many tasks did I finish last
 * week" can produce a confident, well-formatted, wrong number, and a life
 * tracker that invents its own statistics is worse than one that admits it does
 * not know. This design can only say what the database supports, and when nothing
 * matches it says so instead of improvising.
 *
 * It also means the assistant is auditable: `citations` names the exact rows
 * behind every number in the reply, and `evidence` carries them so the UI can
 * show the working.
 */

export type AssistantIntent =
  | "OVERVIEW"
  | "WHAT_NOW"
  | "TASKS_DUE"
  | "OVERDUE"
  | "HABITS"
  | "HABIT_STREAK"
  | "FOCUS"
  | "MOOD"
  | "GOALS"
  | "SCHEDULE"
  | "CAPTURE"
  | "UNKNOWN";

export interface AssistantAnswer {
  intent: AssistantIntent;
  /** The reply itself. Written to be read on its own, no markdown. */
  reply: string;
  /** Human-readable sources, e.g. "14 tasks, 31 habit logs". */
  citations: string[];
  /** The rows behind the numbers, for an expandable "how this was worked out". */
  evidence: Record<string, unknown>;
  /**
   * A task draft the user can accept, when the question was really a capture in
   * disguise ("add buy milk tomorrow"). The caller offers this as a one-tap
   * create rather than writing anything.
   */
  capture: ReturnType<typeof parseTaskText> | null;
  /** Follow-up questions worth offering, chosen from what this intent knows. */
  suggestions: string[];
}

interface Rule {
  intent: AssistantIntent;
  /** Matched against the lower-cased question. */
  patterns: RegExp[];
  /** Higher wins, so a specific rule beats a broad one. */
  weight: number;
}

/**
 * Intent rules, most specific first.
 *
 * `weight` exists because keyword matching is not ordered: "what should I do
 * about my overdue tasks" contains both `overdue` and the vague "what should I
 * do". Without a weight the later rule would silently win, and the more specific
 * intent is always the more useful answer.
 */
const RULES: Rule[] = [
  {
    intent: "CAPTURE",
    // A command, not a question: it starts with a verb and asks to add something.
    patterns: [
      /^add\s+(?:a\s+)?(?:task\s+)?(?!what|how|why)/i,
      /^(?:create|remind me to|note|new task|todo)\b/i,
      /\badd (?:this |it |a )?to my (?:tasks?|list)\b/i,
    ],
    weight: 10,
  },
  {
    intent: "OVERDUE",
    patterns: [/\boverdue\b/i, /\blate\b/i, /\bpast (?:its|their|the) due\b/i, /\bmissed\b/i, /\bbehind on\b/i],
    weight: 9,
  },
  {
    intent: "HABIT_STREAK",
    patterns: [/\bstreak\b/i, /\bconsecutive\b/i],
    weight: 9,
  },
  {
    intent: "WHAT_NOW",
    patterns: [
      /\bwhat (?:should|do|do i)\b/i,
      /\bwhat now\b/i,
      /\bwhere do i (?:start|begin)\b/i,
      /\bnext step\b/i,
      /\bwhat'?s next\b/i,
      /\bhelp me (?:start|begin|focus)\b/i,
    ],
    weight: 8,
  },
  {
    intent: "SCHEDULE",
    patterns: [
      /\bwhen (?:should|do|is|are)\b/i,
      /\bschedul(?:e|ed|ing)\b/i,
      /\bplan (?:my|the|out|tomorrow|today|next)\b/i,
      /\bwhen do i\b/i,
      /\bfree\b/i,
      /\bcalendar\b/i,
    ],
    weight: 7,
  },
  {
    intent: "FOCUS",
    patterns: [/\bfocus\b/i, /\bpomodoro\b/i, /\bdeep work\b/i, /\bconcentrat/i, /\bsessions?\b/i],
    weight: 6,
  },
  {
    intent: "HABITS",
    patterns: [/\bhabit/i, /\bstreak\b/i, /\broutine\b/i, /\bconsistent\b/i, /\badherence\b/i],
    weight: 5,
  },
  {
    intent: "TASKS_DUE",
    patterns: [/\bwhat'?s due\b/i, /\bdue (?:today|tomorrow|this week|next)\b/i, /\bupcoming\b/i, /\bwhat do i have\b/i, /\bmy tasks?\b/i, /\btask list\b/i],
    weight: 5,
  },
  {
    intent: "MOOD",
    patterns: [/\bmood\b/i, /\bfeel\b/i, /\bfeeling\b/i, /\bwellbeing\b/i, /\bwell-being\b/i, /\bstress\b/i, /\banxiet/i, /\bhappy\b/i, /\bsleep\b/i, /\btired\b/i, /\benergy\b/i],
    weight: 5,
  },
  {
    intent: "GOALS",
    patterns: [/\bgoals?\b/i, /\btargets?\b/i, /\bmilestones?\b/i, /\bprogress\b/i, /\bprojects?\b/i],
    weight: 5,
  },
  {
    intent: "OVERVIEW",
    patterns: [/\bhow (?:am i|are things|is it going)\b/i, /\bsummary\b/i, /\boverview\b/i, /\bhow'?s it going\b/i, /\breview\b/i, /\bhow was\b/i, /\blast week\b/i, /\bthis week\b/i, /\bthis month\b/i],
    weight: 4,
  },
];

/**
 * Classify the question.
 *
 * `namesHabit` is a strong signal that keyword matching cannot supply. "How am I
 * doing with my morning run?" contains the generic `how am i` phrasing that routes
 * to OVERVIEW, and no habit keyword at all — but the user named a real habit, and
 * the habit's own logs are a far better answer than a 30-day summary. A concrete
 * reference beats a generic phrase, so it wins.
 */
function classify(question: string, namesHabit: boolean): AssistantIntent {
  let best: { intent: AssistantIntent; weight: number } | null = null;
  for (const rule of RULES) {
    if (!rule.patterns.some((p) => p.test(question))) continue;
    if (!best || rule.weight > best.weight) best = { intent: rule.intent, weight: rule.weight };
  }

  if (namesHabit && (!best || best.weight < HABIT_NAME_WEIGHT)) return "HABITS";
  return best?.intent ?? "UNKNOWN";
}

/** Weight given to "the user named one of their own habits". */
const HABIT_NAME_WEIGHT = 6;

/** The habits a question names, by matching against real habit names. */
function mentionedHabits(question: string, snapshot: LifeSnapshot) {
  const lower = question.toLowerCase();
  return snapshot.habits.filter((h) => {
    const name = h.name.toLowerCase();
    if (name.length < 3) return false;
    if (lower.includes(name)) return true;
    // Also match on the first significant word, so "reading" finds "Read 20 pages".
    const head = name.split(/\s+/)[0] ?? "";
    return head.length >= 4 && lower.includes(head);
  });
}

export function askAssistant(
  snapshot: LifeSnapshot,
  question: string,
  now: Date = new Date(),
): AssistantAnswer {
  const habits = mentionedHabits(question, snapshot);
  const intent = classify(question, habits.length > 0);

  switch (intent) {
    case "CAPTURE":
      return captureAnswer(snapshot, question, now);
    case "OVERDUE":
      return overdueAnswer(snapshot, now);
    case "WHAT_NOW":
      return whatNowAnswer(snapshot, now);
    case "TASKS_DUE":
      return dueAnswer(snapshot, now);
    case "HABIT_STREAK":
    case "HABITS":
      return habitsAnswer(snapshot, habits);
    case "FOCUS":
      return focusAnswer(snapshot, now);
    case "MOOD":
      return moodAnswer(snapshot);
    case "GOALS":
      return goalsAnswer(snapshot, now);
    case "SCHEDULE":
      return scheduleAnswer(snapshot, now);
    case "OVERVIEW":
      return overviewAnswer(snapshot, now);
    default:
      return unknownAnswer(snapshot);
  }
}

function base(intent: AssistantIntent, extra: Partial<AssistantAnswer> = {}): AssistantAnswer {
  return {
    intent,
    reply: "",
    citations: [],
    evidence: {},
    capture: null,
    suggestions: [],
    ...extra,
  };
}

// ------------------------------------------------------------------ capture

function captureAnswer(snapshot: LifeSnapshot, question: string, now: Date): AssistantAnswer {
  // Strip the command word so "add buy milk tomorrow" parses as the task itself
  // rather than creating a task titled "add buy milk".
  const text = question.replace(/^\s*(?:please\s+)?(?:add|create|note|new task|todo)\s+/i, "").trim();
  const parsed = parseTaskText(text, now);

  return base("CAPTURE", {
    reply: `I read that as "${parsed.title}"${parsed.dueAt ? `, due ${formatLocalWeekdayClock(parsed.dueAt)}` : " with no deadline"}. Nothing has been saved yet — check it and add it.`,
    citations: ["parsed locally from your message"],
    evidence: { parsed },
    capture: parsed,
    suggestions: snapshot.habits.length
      ? ["What is on today?", "Am I behind on anything?"]
      : ["What is on today?"],
  });
}

// ------------------------------------------------------------------ overdue

function overdueAnswer(snapshot: LifeSnapshot, now: Date): AssistantAnswer {
  const overdue = snapshot.tasks
    .filter((t) => t.dueAt !== null && t.dueAt.getTime() < now.getTime() && t.status !== "DONE" && t.status !== "CANCELLED" && t.status !== "ARCHIVED")
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));

  if (overdue.length === 0) {
    return base("OVERDUE", {
      reply: "Nothing is overdue. Whatever else is going on, that is not one of the problems.",
      citations: [`${snapshot.tasks.length} open tasks checked`],
      evidence: { overdue: 0 },
      suggestions: ["What is on today?", "Plan my day"],
    });
  }

  const titles = overdue.slice(0, 3).map((t) => `"${t.title}"`).join(", ");
  const rest = overdue.length > 3 ? `, and ${overdue.length - 3} more` : "";
  const minutes = overdue.reduce((total, t) => total + (t.estimatedMinutes ?? 25), 0);

  return base("OVERDUE", {
    reply: `${overdue.length} ${overdue.length === 1 ? "task is" : "tasks are"} past due: ${titles}${rest}. By your own estimates that is about ${formatDuration(minutes)} of work. The most useful thing here is to decide which of these still deserve to exist — deleting one is as legitimate as finishing it.`,
    citations: [`${overdue.length} overdue tasks`],
    evidence: {
      count: overdue.length,
      estimatedMinutes: minutes,
      tasks: overdue.slice(0, 10).map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt?.toISOString() ?? null,
        daysOverdue: t.dueAt ? Math.floor((now.getTime() - t.dueAt.getTime()) / 86_400_000) : null,
        estimatedMinutes: t.estimatedMinutes,
        priority: t.priority,
      })),
    },
    suggestions: ["Plan my day", "How am I doing overall?", "What is on today?"],
  });
}

// ------------------------------------------------------------------ what now

function whatNowAnswer(snapshot: LifeSnapshot, now: Date): AssistantAnswer {
  const open = snapshot.tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS" || t.status === "BLOCKED");
  const today = dateOnly(now);
  const overdue = open.filter((t) => t.dueAt !== null && t.dueAt.getTime() < now.getTime());
  const dueToday = open.filter((t) => t.dueAt !== null && dateOnly(t.dueAt).getTime() === today.getTime());
  const inProgress = open.filter((t) => t.status === "IN_PROGRESS");

  const habitDueToday = snapshot.habits.filter((h) =>
    snapshot.habitLogs.some(
      (log) => log.habitId === h.id && dateOnly(log.date).getTime() === today.getTime() && log.completed,
    )
    === false
      ? h.scheduledDays.length === 0 || h.scheduledDays.includes(today.getUTCDay())
      : false,
  );

  const lines: string[] = [];
  const evidence: Record<string, unknown> = {
    overdue: overdue.length,
    dueToday: dueToday.length,
    inProgress: inProgress.length,
    open: open.length,
    habitsOutstanding: habitDueToday.length,
  };

  if (overdue.length > 0) {
    lines.push(
      `Start with the ${overdue.length} overdue ${overdue.length === 1 ? "item" : "items"} — "${overdue[0]!.title}" is the oldest. Clearing one does more for the rest of the day than planning a better one.`,
    );
  }

  if (inProgress.length > 0) {
    lines.push(
      `Then finish "${inProgress[0]!.title}", which is already open. Half-finished work costs more to keep open than to close.`,
    );
  }

  if (dueToday.length > 0) {
    const minutes = dueToday.reduce((total, t) => total + (t.estimatedMinutes ?? 25), 0);
    lines.push(
      `${dueToday.length} ${dueToday.length === 1 ? "is" : "are"} due today, about ${formatDuration(minutes)} in total.`,
    );
  }

  if (habitDueToday.length > 0 && habitDueToday.length <= 4) {
    lines.push(
      `And ${habitDueToday.length === 1 ? "one habit is" : `${habitDueToday.length} habits are`} still unlogged today: ${habitDueToday.map((h) => h.name).join(", ")}.`,
    );
  } else if (habitDueToday.length > 4) {
    lines.push(
      `${habitDueToday.length} habits are still unlogged today. Doing one is better than all of them tomorrow.`,
    );
  }

  if (lines.length === 0) {
    if (open.length === 0) {
      return base("WHAT_NOW", {
        reply:
          snapshot.habits.length > 0
            ? "Nothing is open and nothing is due. That is a genuinely clear board — worth using rather than filling up. Pick the one goal that matters most this week and give it a task."
            : "Nothing is open, due or logged. There is no data to reason about yet — add a habit or a task and this becomes useful quickly.",
        citations: ["0 open tasks"],
        evidence,
        suggestions: ["How am I doing overall?", "Which habit am I worst at?"],
      });
    }
    lines.push("Nothing is overdue and nothing is due today. Good position to start something.");
  }

  return base("WHAT_NOW", {
    reply: lines.join(" "),
    citations: [
      `${open.length} open tasks`,
      `${snapshot.habitLogs.length} habit logs`,
    ],
    evidence,
    suggestions: ["Plan my day", "Am I behind on anything?", "How am I doing overall?"],
  });
}

// ------------------------------------------------------------------ due

function dueAnswer(snapshot: LifeSnapshot, now: Date): AssistantAnswer {
  const window = whenWindow(now);
  const due = snapshot.tasks
    .filter((t) => t.dueAt !== null && t.status !== "DONE" && t.status !== "CANCELLED" && t.status !== "ARCHIVED")
    .filter((t) => {
      const d = dateOnly(t.dueAt!);
      return d.getTime() >= window.from.getTime() && d.getTime() <= window.to.getTime();
    })
    .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));

  if (due.length === 0) {
    // Named before the template so the "next deadline" phrase can be built
    // without repeating the filter-and-sort chain inside an interpolation.
    const nextUp = snapshot.tasks
      .filter((t) => t.dueAt !== null && t.status !== "DONE")
      .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))[0];

    return base("TASKS_DUE", {
      reply: `Nothing due ${window.label}. The next thing with a deadline is ${
        nextUp?.dueAt ? formatIndianDate(nextUp.dueAt) : "not on the list at all"
      }.`,
      citations: [`${snapshot.tasks.length} tasks checked`],
      evidence: { window: window.label, count: 0 },
      suggestions: ["Plan my day", "What should I do first?"],
    });
  }

  const minutes = due.reduce((total, t) => total + (t.estimatedMinutes ?? 25), 0);
  const urgent = due.filter((t) => t.priority === "URGENT" || t.priority === "HIGH").length;
  const first = due[0]!;

  return base("TASKS_DUE", {
    reply: `${due.length} ${due.length === 1 ? "task is" : "tasks are"} due ${window.label}, about ${formatDuration(minutes)} in all${
      urgent > 0 ? `, ${urgent} of them high or urgent` : ""
    }. First up is "${first.title}"${
      first.dueAt ? ` at ${formatLocalWeekdayClock(first.dueAt)}` : ""
    }.`,
    citations: [`${due.length} tasks in window`],
    evidence: {
      window: window.label,
      count: due.length,
      estimatedMinutes: minutes,
      urgent,
      tasks: due.slice(0, 12).map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: t.dueAt?.toISOString() ?? null,
        estimatedMinutes: t.estimatedMinutes,
        priority: t.priority,
        status: t.status,
      })),
    },
    suggestions: ["Plan my day", "Am I behind on anything?", "What should I do first?"],
  });
}

/**
 * The period a bare "what's due" question means.
 *
 * Seven days, ending today. Short on purpose: a horizon long enough to be
 * complete stops being a list you can act on and becomes an inventory.
 */
function whenWindow(now: Date): { from: Date; to: Date; label: string } {
  return { from: dateOnly(now), to: addDaysUtc(dateOnly(now), 7), label: "in the next 7 days" };
}

// ------------------------------------------------------------------ habits

function habitsAnswer(
  snapshot: LifeSnapshot,
  mentioned: LifeSnapshot["habits"],
): AssistantAnswer {
  const logsByHabit = new Map<string, { completed: number; days: Set<number> }>();
  for (const log of snapshot.habitLogs) {
    if (!log.completed) continue;
    const bucket = logsByHabit.get(log.habitId) ?? { completed: 0, days: new Set<number>() };
    bucket.completed += 1;
    bucket.days.add(dateOnly(log.date).getTime());
    logsByHabit.set(log.habitId, bucket);
  }

  if (mentioned.length > 0) {
    const habit = mentioned[0]!;
    const bucket = logsByHabit.get(habit.id);
    const windowDays = daysBetween(snapshot.from, snapshot.to) + 1;
    if (!bucket || bucket.completed === 0) {
      return base("HABITS", {
        reply: `You have no completed logs for "${habit.name}" in the last ${windowDays} days. Either it is new, or it is not happening — and at ${windowDays} days in, the second reading is usually the right one.`,
        citations: [`${snapshot.habitLogs.filter((l) => l.habitId === habit.id).length} logs for ${habit.name}`],
        evidence: { habitId: habit.id, habitName: habit.name, completed: 0, windowDays },
        suggestions: ["Which habit am I worst at?", "How am I doing overall?"],
      });
    }

    const rate = pct(bucket.completed, windowDays);
    const recent = [...bucket.days].sort((a, b) => b - a);
    let streak = 0;
    let cursor = recent[0]!;
    while (bucket.days.has(cursor)) {
      streak += 1;
      cursor -= 86_400_000;
    }

    const best = byWeekdayRate(snapshot, habit.id);
    return base("HABITS", {
      reply: `"${habit.name}": ${bucket.completed} of the last ${windowDays} days, ${rate}%${
        streak > 1 ? `, with a current run of ${streak} days` : ""
      }.${
        best ? ` You are strongest on ${weekdayName(best.bestDay)}s (${best.byDay[best.bestDay] ?? 0}%) and weakest on ${weekdayName(best.worstDay)}s (${best.byDay[best.worstDay] ?? 0}%).` : ""
      }`,
      citations: [`${bucket.completed} completed logs for ${habit.name}`],
      evidence: {
        habitId: habit.id,
        habitName: habit.name,
        completed: bucket.completed,
        windowDays,
        ratePercent: rate,
        streak,
        ...(best ? { byWeekday: best.byDay } : {}),
      },
      suggestions: ["Which habit am I worst at?", "How am I doing overall?", "What should I do first?"],
    });
  }

  // No habit named: summarise the list.
  if (snapshot.habits.length === 0) {
    return base("HABITS", {
      reply: "You have not set up any habits yet. Start with one, and make it small enough that a bad day does not break it.",
      citations: ["0 habits"],
      evidence: { habits: 0 },
      suggestions: ["How am I doing overall?"],
    });
  }

  const rates = snapshot.habits
    .map((h) => {
      const bucket = logsByHabit.get(h.id);
      const expected = Math.max(1, daysBetween(snapshot.from, snapshot.to) + 1);
      return { name: h.name, id: h.id, completed: bucket?.completed ?? 0, expected, rate: pct(bucket?.completed ?? 0, expected) };
    })
    .sort((a, b) => a.rate - b.rate);

  const worst = rates[0]!;
  const best = rates[rates.length - 1]!;
  const totalCompleted = sum0(rates.map((r) => r.completed));
  const totalExpected = sum0(rates.map((r) => r.expected));

  return base("HABITS", {
    reply: `${pct(totalCompleted, totalExpected)} overall across ${snapshot.habits.length} habits — ${totalCompleted} logged out of ${totalExpected} expected. Best is ${best.name} at ${best.rate}%, weakest is ${worst.name} at ${worst.rate}%.${
      worst.rate < 50 ? ` ${worst.name} is the one to either shrink or drop; at ${worst.rate}% it is currently costing you more in guilt than it is returning.` : ""
    }`,
    citations: [`${snapshot.habits.length} habits`, `${totalCompleted} completed logs`],
    evidence: { byHabit: rates, overallRatePercent: pct(totalCompleted, totalExpected) },
    suggestions: [`How am I doing with ${worst.name}?`, "How am I doing overall?", "What should I do first?"],
  });
}

function sum0(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function byWeekdayRate(
  snapshot: LifeSnapshot,
  habitId: string,
): { byDay: Record<number, number>; bestDay: number; worstDay: number } | null {
  const totals = new Map<number, { done: number; total: number }>();
  for (const log of snapshot.habitLogs) {
    if (log.habitId !== habitId) continue;
    const day = utcWeekday(dateOnly(log.date));
    const bucket = totals.get(day) ?? { done: 0, total: 0 };
    bucket.total += 1;
    if (log.completed) bucket.done += 1;
    totals.set(day, bucket);
  }
  if (totals.size < 3) return null;

  const byDay: Record<number, number> = {};
  for (const [day, b] of totals) byDay[day] = pct(b.done, b.total);
  const entries = Object.entries(byDay).map(([day, rate]) => ({ day: Number(day), rate }));
  const sorted = [...entries].sort((a, b) => b.rate - a.rate);
  const bestDay = sorted[0]!.day;
  const worstDay = sorted[sorted.length - 1]!.day;
  return { byDay, bestDay, worstDay };
}

// ------------------------------------------------------------------ focus

function focusAnswer(snapshot: LifeSnapshot, now: Date): AssistantAnswer {
  void now;
  const windowDays = daysBetween(snapshot.from, snapshot.to) + 1;
  const sessions = snapshot.focusSessions.filter((s) => s.endedAt !== null);
  if (sessions.length === 0) {
    return base("FOCUS", {
      reply: `No completed focus sessions in the last ${windowDays} days. The timer is the cheapest thing in this app to start using — one 25-minute session tomorrow would give the rest of this something to work with.`,
      citations: ["0 completed focus sessions"],
      evidence: { sessions: 0, windowDays },
      suggestions: ["Plan my day", "How am I doing overall?"],
    });
  }

  const totalMinutes = Math.round(sessions.reduce((t, s) => t + s.actualSeconds, 0) / 60);
  const perDay = round(totalMinutes / windowDays, 1);
  const early = sessions.filter((s) => s.endedEarly).length;
  const rated = sessions.filter((s) => s.rating !== null);
  const avgRating = rated.length ? round(mean(rated.map((s) => s.rating!)), 1) : null;
  const longest = Math.max(...sessions.map((s) => s.actualSeconds));

  return base("FOCUS", {
    reply: `${sessions.length} sessions over ${windowDays} days, ${formatDuration(totalMinutes)} in total — ${perDay} minutes a day. ${
      early > 0 ? `${pct(early, sessions.length)}% ended before the timer. ` : ""
    }${
      avgRating !== null ? `You rate them ${avgRating} out of 5 on average. ` : ""
    }Longest single session: ${Math.round(longest / 60)} minutes.`,
    citations: [`${sessions.length} focus sessions`, `${windowDays}-day window`],
    evidence: {
      sessions: sessions.length,
      windowDays,
      totalMinutes,
      minutesPerDay: perDay,
      endedEarly: early,
      avgRating,
      longestMinutes: Math.round(longest / 60),
    },
    suggestions: ["How am I feeling?", "What should I do first?", "Plan my day"],
  });
}

// ------------------------------------------------------------------ mood

function moodAnswer(snapshot: LifeSnapshot): AssistantAnswer {
  const entries = snapshot.moodEnergy;
  const windowDays = daysBetween(snapshot.from, snapshot.to) + 1;
  if (entries.length === 0) {
    return base("MOOD", {
      reply: "You have not logged how you have been feeling. It takes about ten seconds a day, and it is the only way the app can tell you anything about patterns rather than just counts.",
      citations: ["0 mood check-ins"],
      evidence: { entries: 0, windowDays },
      suggestions: ["How am I doing overall?", "Plan my day"],
    });
  }

  const recent = [...entries].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 7);
  const recentMood = mean(recent.map((e) => e.mood));
  const overallMood = mean(entries.map((e) => e.mood));
  const avgEnergy = mean(entries.map((e) => e.energy));
  const avgStress = mean(entries.map((e) => e.stress));
  const sleep = entries.filter((e) => e.sleepHours !== null);

  const trend = overallMood - recentMood;

  return base("MOOD", {
    reply: `Across ${entries.length} check-ins your mood averages ${round(overallMood, 1)} out of 5, energy ${round(avgEnergy, 1)} and stress ${round(avgStress, 1)}. Over the last ${recent.length} logged days it is ${round(recentMood, 1)}${
      Math.abs(trend) >= 0.4
        ? ` — ${trend > 0 ? "better" : "worse"} than your average, which is worth noticing in itself`
        : ", in line with your average"
    }.${sleep.length >= 3 ? ` You are averaging ${round(mean(sleep.map((e) => e.sleepHours!)), 1)} hours of sleep.` : ""}`,
    citations: [`${entries.length} mood check-ins`],
    evidence: {
      entries: entries.length,
      avgMood: round(overallMood, 2),
      recentMood: round(recentMood, 2),
      avgEnergy: round(avgEnergy, 2),
      avgStress: round(avgStress, 2),
      avgSleepHours: sleep.length >= 3 ? round(mean(sleep.map((e) => e.sleepHours!)), 2) : null,
      recentDates: recent.map((e) => dateOnly(e.date).toISOString().slice(0, 10)),
    },
    suggestions: ["How am I doing overall?", "What should I do first?"],
  });
}

// ------------------------------------------------------------------ goals

function goalsAnswer(snapshot: LifeSnapshot, now: Date): AssistantAnswer {
  const active = snapshot.goals.filter((g) => g.status === "ACTIVE");
  if (active.length === 0) {
    return base("GOALS", {
      reply:
        snapshot.goals.length > 0
          ? `None of your goals are active — all ${snapshot.goals.length} are achieved, paused or abandoned. That is worth a look, in case one of them is just paused rather than finished.`
          : "You have not set any goals. A goal is the one thing a task list cannot tell you: it is what the tasks are for.",
      citations: [`${snapshot.goals.length} goals`],
      evidence: { goals: snapshot.goals.length, active: 0 },
      suggestions: ["How am I doing overall?", "What should I do first?"],
    });
  }

  const rows = active
    .map((g) => {
      const daysLeft = g.targetDate ? daysBetween(now, g.targetDate) : null;
      return {
        title: g.title,
        progress: pct(Math.round(g.progress), 100),
        daysLeft,
        milestones: `${g.doneMilestoneCount}/${g.milestoneCount}`,
      };
    })
    .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

  const lead = rows[0]!;
  const behind = rows.filter((r) => r.daysLeft !== null && r.daysLeft <= 14 && r.progress < 50);

  return base("GOALS", {
    reply: `${active.length} active ${active.length === 1 ? "goal" : "goals"}. ${
      lead.daysLeft !== null
        ? `"${lead.title}" is nearest its deadline — ${lead.progress}% done with ${lead.daysLeft} days left${lead.milestones !== "0/0" ? ` and ${lead.milestones} milestones` : ""}.`
        : `"${lead.title}" is at ${lead.progress}% and has no deadline set.`
    }${behind.length > 0 ? ` ${behind.length} of them ${behind.length === 1 ? "is" : "are"} inside two weeks and under halfway — those are the ones that need a decision.` : ""}`,
    citations: [`${active.length} active goals`],
    evidence: {
      active: active.length,
      goals: rows,
      projects: snapshot.projects.map((p) => ({
        name: p.name,
        status: p.status,
        done: `${p.doneTaskCount}/${p.taskCount}`,
        milestones: `${p.doneMilestoneCount}/${p.milestoneCount}`,
      })),
    },
    suggestions: ["What should I do first?", "How am I doing overall?", "Am I behind on anything?"],
  });
}

// ------------------------------------------------------------------ schedule

function scheduleAnswer(snapshot: LifeSnapshot, now: Date): AssistantAnswer {
  const day = dateOnly(now);
  const blocks = snapshot.timeBlocks
    .filter((b) => dateOnly(b.startAt).getTime() === day.getTime())
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const budget = availableMinutes(snapshot, day);
  const booked = blocks.reduce((total, b) => total + (b.endAt.getTime() - b.startAt.getTime()) / 60_000, 0);
  const open = snapshot.tasks.filter(
    (t) => (t.status === "TODO" || t.status === "IN_PROGRESS") && t.estimatedMinutes !== null,
  );
  const wanted = open.reduce((total, t) => total + t.estimatedMinutes!, 0);

  if (blocks.length === 0 && wanted === 0) {
    return base("SCHEDULE", {
      reply: "Nothing is on today's calendar and no open task has an estimate, so there is nothing to plan from. Adding an estimate to a couple of tasks is enough to make this work.",
      citations: [`${blocks.length} blocks today`],
      evidence: { blocks: 0, availableMinutes: budget },
      suggestions: ["What is on today?", "What should I do first?"],
    });
  }

  const slotText = blocks
    .map((b) => `${formatMinutes(b.startAt.getHours() * 60 + b.startAt.getMinutes())}–${formatMinutes(b.endAt.getHours() * 60 + b.endAt.getMinutes())}`)
    .join(", ");

  return base("SCHEDULE", {
    reply: `Today has ${blocks.length} ${blocks.length === 1 ? "block" : "blocks"}${slotText ? ` (${slotText})` : ""}, using ${formatDuration(booked)} of roughly ${formatDuration(budget)} available.${
      wanted > budget
        ? ` You have ${open.length} estimated open tasks totalling ${formatDuration(wanted)}, which is ${formatDuration(wanted - budget)} more than fits. Something has to move.`
        : ` Your ${open.length} estimated open tasks total ${formatDuration(wanted)}, so the day can hold them.`
    }`,
    citations: [`${blocks.length} blocks today`, `${open.length} estimated open tasks`],
    evidence: {
      blocks: blocks.map((b) => ({
        title: b.title,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        locked: b.locked,
        source: b.source,
      })),
      availableMinutes: budget,
      bookedMinutes: Math.round(booked),
      wantedMinutes: wanted,
    },
    suggestions: ["What should I do first?", "Am I behind on anything?", "What is on today?"],
  });
}

// ------------------------------------------------------------------ overview

function overviewAnswer(snapshot: LifeSnapshot, now: Date): AssistantAnswer {
  const windowDays = daysBetween(snapshot.from, snapshot.to) + 1;
  const completed = snapshot.tasks.filter((t) => t.completedAt !== null);
  const open = snapshot.tasks.filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS" || t.status === "BLOCKED");
  const overdue = open.filter((t) => t.dueAt !== null && t.dueAt.getTime() < now.getTime());
  const focusMinutes = Math.round(
    snapshot.focusSessions.filter((s) => s.endedAt !== null).reduce((t, s) => t + s.actualSeconds, 0) / 60,
  );
  const habitLogs = snapshot.habitLogs.filter((l) => l.completed).length;

  if (snapshot.sparse) {
    return base("OVERVIEW", {
      reply: `Not enough recorded yet to say anything honest — ${habitLogs} completed habit logs, ${completed.length} finished tasks and ${focusMinutes} minutes of focus over ${windowDays} days. A week or so of ordinary use and this will have something to work with.`,
      citations: [`${windowDays}-day window`, `${habitLogs} habit logs`],
      evidence: { sparse: true, windowDays, habitLogs, completed: completed.length, focusMinutes },
      suggestions: ["What should I do first?", "Plan my day", "Which habit am I worst at?"],
    });
  }

  const perDay = round(focusMinutes / windowDays, 1);
  const habitRate = pct(habitLogs, Math.max(1, snapshot.habits.length * windowDays));

  return base("OVERVIEW", {
    reply: `Last ${windowDays} days: ${completed.length} tasks finished, ${habitLogs} habit logs (${habitRate}% of what was expected), ${focusMinutes} minutes of focus — ${perDay} a day. ${
      overdue.length > 0
        ? `${overdue.length} ${overdue.length === 1 ? "item is" : "items are"} overdue, which is the number most worth fixing.`
        : "Nothing is overdue."
    } ${snapshot.moodEnergy.length > 0 ? `Mood has averaged ${round(mean(snapshot.moodEnergy.map((e) => e.mood)), 1)} out of 5.` : ""}`,
    citations: [
      `${windowDays}-day window`,
      `${completed.length} completed tasks`,
      `${habitLogs} habit logs`,
      `${focusMinutes} focus minutes`,
    ],
    evidence: {
      windowDays,
      completed: completed.length,
      open: open.length,
      overdue: overdue.length,
      focusMinutes,
      minutesPerDay: perDay,
      habitLogs,
      habitRatePercent: habitRate,
      avgMood: snapshot.moodEnergy.length ? round(mean(snapshot.moodEnergy.map((e) => e.mood)), 2) : null,
    },
    suggestions: ["What should I do first?", "Am I behind on anything?", "Which habit am I worst at?"],
  });
}

// ------------------------------------------------------------------ unknown

function unknownAnswer(snapshot: LifeSnapshot): AssistantAnswer {
  const ability = [
    snapshot.tasks.length > 0 ? "what is due" : null,
    snapshot.habits.length > 0 ? "habit streaks" : null,
    snapshot.focusSessions.length > 0 ? "focus time" : null,
    snapshot.moodEnergy.length > 0 ? "mood" : null,
    snapshot.goals.length > 0 ? "goals" : null,
  ]
    .filter((v): v is string => v !== null)
    .join(", ");

  return base("UNKNOWN", {
    reply: ability
      ? `I did not recognise that as something I can answer from your data. I can talk about ${ability} — or you can add a task by saying "add …". I work from your records rather than guessing, so anything I cannot look up I will not pretend to.`
      : `There is not enough in your account yet for me to answer anything, and I would rather say so than make something up. Start by adding a habit or a task.`,
    citations: [],
    evidence: { available: ability || null },
    suggestions: ["What should I do first?", "How am I doing overall?", "Plan my day"],
  });
}
