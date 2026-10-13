import { describe, expect, it } from "vitest";

import {
completedTasks,
estimatedHoursFromTasks,
focusSessionCount,
focusedHours,
habitSessions,
paceLabel,
planProgress,
type PlanCategory,
type PlanFocusSessionInput,
type PlanHabitLogInput,
type PlanTargetType,
} from "@/lib/weekly-plans/progress";
import {
  daysElapsed,
  weekBounds,
  weekOffset,
  windowPace,
  withinWindow,
  type WeekBounds,
} from "@/lib/weekly-plans/week";

/**
 * A Monday-start week: 2026-09-28 (Mon) .. 2026-10-04 (Sun).
 */
const WEEK: WeekBounds = {
  start: new Date("2026-09-28T00:00:00.000Z"),
  end: new Date("2026-10-04T00:00:00.000Z"),
};

/** Tuesday, second day of the window. */
const TUESDAY = new Date("2026-09-29T00:00:00.000Z");

const session = (
  startedAt: string,
  actualSeconds: number,
  ended = true,
): PlanFocusSessionInput => ({
  taskId: "task-1",
  startedAt: new Date(startedAt),
  actualSeconds,
  ended,
});

const habitLog = (
  date: string,
  completed = true,
  habitId = "habit-1",
  value = 1,
): PlanHabitLogInput => ({
  habitId,
  date: new Date(`${date}T00:00:00.000Z`),
  completed,
  value,
});

/**
 * Default category for tests that do not care.
 *
 * `CUSTOM` is chosen rather than `FITNESS` precisely because it is the *unmeasurable*
 * case for `SESSIONS`: a test that forgets to set a category gets a refusal to
 * measure rather than a plausible-looking number, so the mistake surfaces as a
 * failing assertion instead of a green test asserting the wrong thing.
 */
function base(overrides: Partial<Parameters<typeof planProgress>[0]> = {}) {
  return {
    plan: {
      targetType: "HOURS" as PlanTargetType,
    category: "CUSTOM" as PlanCategory,
      targetValue: 5,
      status: "ACTIVE" as const,
    },
    bounds: WEEK,
    today: TUESDAY,
    tasks: [],
    habits: [],
    focusSessions: [],
    ...overrides,
  };
}

describe("weekBounds", () => {
  it("starts on Monday by default and spans seven days inclusive", () => {
    const bounds = weekBounds(new Date("2026-09-30T11:00:00.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-04T00:00:00.000Z");
  });

  it("anchors to UTC midnight, not server-local midnight", () => {
    // The failure this guards: date-fns startOfWeek in IST returns 18:30 UTC the
    // previous Sunday, which matches no @db.Date row and renders an empty week.
    const bounds = weekBounds(new Date("2026-09-28T00:30:00.000Z"));
    expect(bounds.start.getUTCHours()).toBe(0);
    expect(bounds.start.getUTCMinutes()).toBe(0);
  });

  it("honours a Sunday week start", () => {
    const bounds = weekBounds(new Date("2026-10-01T09:00:00.000Z"), 0);
    expect(bounds.start.toISOString()).toBe("2026-09-27T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-03T00:00:00.000Z");
  });

  it("falls back to Monday for an unrecognised week start rather than producing a future window", () => {
    const bounds = weekBounds(new Date("2026-09-30T09:00:00.000Z"), 4);
    expect(bounds.start.toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });
});

describe("weekOffset", () => {
  it("moves a whole week at a time", () => {
    const last = weekOffset(new Date("2026-09-30T09:00:00.000Z"), -1);
    expect(last.start.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(last.end.toISOString()).toBe("2026-09-27T00:00:00.000Z");
  });

  it("keeps exactly seven days for every offset", () => {
    for (const offset of [-3, -1, 0, 1, 5]) {
      const bounds = weekOffset(new Date("2026-09-30T09:00:00.000Z"), offset);
      expect(daysElapsed(bounds).total).toBe(7);
    }
  });
});

describe("daysElapsed", () => {
  it("counts the first day as elapsed one", () => {
    expect(daysElapsed(WEEK, WEEK.start).elapsed).toBe(1);
  });

  it("clamps a future window to not-started rather than negative days", () => {
    const result = daysElapsed(WEEK, new Date("2026-10-05T00:00:00.000Z"));
    expect(result.elapsed).toBe(7);
    expect(result.remaining).toBe(0);
  });

  it("clamps a past window to fully elapsed", () => {
    const result = daysElapsed(WEEK, new Date("2026-10-20T00:00:00.000Z"));
    expect(result.elapsed).toBe(7);
    expect(result.remaining).toBe(0);
    expect(result.total).toBe(7);
  });
});

describe("windowPace", () => {
  it("is null before the window opens, not 0", () => {
    // A plan starting next Monday has not failed to make progress. Reporting 0%
    // here would be a false signal in the one place a false signal costs most.
    expect(windowPace(WEEK, new Date("2026-09-27T00:00:00.000Z"))).toBeNull();
  });

  it("is a fraction of the window at the midpoint", () => {
    expect(windowPace(WEEK, TUESDAY)).toBeCloseTo(2 / 7, 5);
  });
});

describe("withinWindow", () => {
  it("includes both boundary days", () => {
    expect(withinWindow(WEEK.start, WEEK)).toBe(true);
    expect(withinWindow(WEEK.end, WEEK)).toBe(true);
  });

  it("excludes the day after the window", () => {
    expect(withinWindow(new Date("2026-10-05T00:00:00.000Z"), WEEK)).toBe(false);
  });
});

describe("focusedHours", () => {
  it("sums elapsed seconds into hours", () => {
    const hours = focusedHours(
      [session("2026-09-28T09:00:00.000Z", 1800), session("2026-09-29T09:00:00.000Z", 1800)],
      WEEK,
    );
    expect(hours).toBe(1);
  });

  it("excludes sessions outside the window", () => {
    // Friday the 25th belongs to last week, even though it is recent.
    const hours = focusedHours(
      [
        session("2026-09-25T09:00:00.000Z", 3600),
        session("2026-10-04T09:00:00.000Z", 3600),
      ],
      WEEK,
    );
    expect(hours).toBe(1);
  });

  it("excludes a session that has not ended yet", () => {
    // A running session has actualSeconds still 0; counting it would make the bar
    // jump on its own once it finishes, which reads as a bug.
    expect(focusedHours([session("2026-09-28T09:00:00.000Z", 0, false)], WEEK)).toBe(0);
  });

  it("ignores sessions with no task, which cannot be attributed to this plan", () => {
    const unattributed: PlanFocusSessionInput = {
      taskId: null,
      startedAt: new Date("2026-09-28T09:00:00.000Z"),
      actualSeconds: 3600,
      ended: true,
    };
    expect(focusedHours([unattributed], WEEK)).toBe(0);
  });

  it("returns 0 for no sessions", () => {
    expect(focusedHours([], WEEK)).toBe(0);
  });
});

describe("habitSessions", () => {
  it("counts a log that is completed, or that recorded real partial work", () => {
    // `completed || value > 0` is the rule `fitness/page.tsx` publishes for its
    // headline total. Matching it is the point: a plan pointing at the "Gym" habit
    // and the Fitness page pointing at the same habit must not disagree about how
    // many sessions it holds.
    const logs = [
      habitLog("2026-09-28"), // completed, value 1
      habitLog("2026-09-29", false, "habit-1", 5), // partial: 5km, not ticked done
      habitLog("2026-09-30", false, "habit-1", 0), // genuinely empty
    ];
    expect(habitSessions(logs, WEEK)).toBe(2);
  });

  it("does not count an empty log row", () => {
    // The distinguishing case between "partial work" and "nothing recorded". A row
    // exists for every day a habit was even *seen*, so counting rows would report a
    // skipped day as a finished one.
    expect(habitSessions([habitLog("2026-09-29", false, "habit-1", 0)], WEEK)).toBe(0);
  });

  it("excludes logs outside the window", () => {
    expect(
   habitSessions([habitLog("2026-09-25"), habitLog("2026-10-05")], WEEK),
    ).toBe(0);
  });
});

describe("focusSessionCount", () => {
  it("counts finished, attributed sessions inside the window", () => {
    expect(
      focusSessionCount(
     [
   session("2026-09-28T09:00:00.000Z", 3600),
          session("2026-09-29T09:00:00.000Z", 60),
     session("2026-09-30T23:30:00.000Z", 30),
        ],
        WEEK,
      ),
    ).toBe(3);
  });

  it("excludes a session that has not ended", () => {
    expect(
      focusSessionCount([session("2026-09-28T09:00:00.000Z", 0, false)], WEEK),
    ).toBe(0);
  });

  it("excludes a session with no task to attribute it to", () => {
    const unattributed: PlanFocusSessionInput = {
      taskId: null,
      startedAt: new Date("2026-09-28T09:00:00.000Z"),
      actualSeconds: 3600,
      ended: true,
    };
    expect(focusSessionCount([unattributed], WEEK)).toBe(0);
  });

  it("includes the final day and excludes the day after", () => {
    // Half-open range with an inclusive end date. Getting this backwards drops the
    // last day of every plan from both its hours and its session count.
    expect(
      focusSessionCount(
    [
          session("2026-10-04T12:00:00.000Z", 3600),
          session("2026-10-05T00:00:00.000Z", 3600),
        ],
        WEEK,
      ),
    ).toBe(1);
  });

it("agrees with focusedHours about which sessions count", () => {
    // The two share a predicate on purpose. Two independent implementations of
    // "which sessions belong to this plan" is how a card showing hours and a badge
    // showing sessions end up telling different stories.
    //
    // Four rows, only one of which is finished, attributed and inside the window:
    // the second has not ended, the third is after the end date, the fourth has no
    // task. Both functions must drop the same three.
  const qualifying = session("2026-09-28T09:00:00.000Z", 3600);
    const sessions = [
      qualifying,
      session("2026-09-29T09:00:00.000Z", 0, false),
      session("2026-10-06T09:00:00.000Z", 3600),
   { ...session("2026-09-30T09:00:00.000Z", 1800), taskId: null },
    ];

    // Comparing against the one row that qualifies, rather than a hardcoded number,
 // keeps the assertion about the shared predicate instead of about today's count.
    expect(focusSessionCount(sessions, WEEK)).toBe(1);
    expect(focusedHours(sessions, WEEK)).toBe(qualifying.actualSeconds / 3600);

    // And one more qualifying row moves both together.
    const twoQualifying = [...sessions, session("2026-10-04T23:30:00.000Z", 600)];
    expect(focusSessionCount(twoQualifying, WEEK)).toBe(2);
  });
});

describe("completedTasks", () => {
  it("counts DONE tasks and nothing else", () => {
    const tasks = [
      { id: "a", status: "DONE", completedAt: TUESDAY },
      { id: "b", status: "IN_PROGRESS", completedAt: null },
      { id: "c", status: "DONE", completedAt: TUESDAY },
      { id: "d", status: "TODO", completedAt: null },
    ];
    expect(completedTasks(tasks)).toBe(2);
  });
});

describe("planProgress", () => {
  it("computes percent from hours against an hours target", () => {
    const result = planProgress(
      base({ focusSessions: [session("2026-09-28T09:00:00.000Z", 18000)] }),
    );
    expect(result.actual).toBe(5);
    expect(result.target).toBe(5);
    expect(result.percent).toBe(1);
    expect(result.remaining).toBe(0);
    expect(result.unit).toBe("hours");
  });

  it("allows overshoot rather than clamping to 100%", () => {
    // 12 hours against a 5 hour plan is a good week. Clamping discards the
    // difference between "just met it" and "did more than twice as much".
    const result = planProgress(
      base({
        plan: { targetType: "HOURS", category: "CUSTOM", targetValue: 5, status: "ACTIVE" },
        focusSessions: [session("2026-09-28T09:00:00.000Z", 43200)],
      }),
    );
    expect(result.actual).toBe(12);
    expect(result.percent).toBe(2.4);
  });

  it("returns null percent for a zero target instead of dividing by zero", () => {
    // A plan created before its target is set is a real state, not an error.
    const result = planProgress(
      base({ plan: { targetType: "HOURS", category: "CUSTOM", targetValue: 0, status: "ACTIVE" } }),
    );
    expect(result.percent).toBeNull();
    expect(result.remaining).toBe(0);
  });

  it("treats a negative target as no target", () => {
    const result = planProgress(
      base({ plan: { targetType: "HOURS", category: "CUSTOM", targetValue: -3, status: "ACTIVE" } }),
    );
    expect(result.percent).toBeNull();
  });

  it("measures a FITNESS SESSIONS plan from habit logs, not focus time", () => {
    const result = planProgress(
      base({
        plan: {
          targetType: "SESSIONS",
          category: "FITNESS",
          targetValue: 6,
          status: "ACTIVE",
        },
        habits: [
habitLog("2026-09-28"),
          habitLog("2026-09-29"),
          habitLog("2026-09-30"),
    habitLog("2026-09-28", true, "habit-2"),
        ],
        focusSessions: [session("2026-09-28T09:00:00.000Z", 3600)],
      }),
    );
    expect(result.actual).toBe(4);
    expect(result.unit).toBe("sessions");
  });

  it("measures a STUDY SESSIONS plan from focus sessions, not habit logs", () => {
    // The inverse of the case above, and the reason `SESSIONS` switches on category.
    // Study work is not recorded as habit logs, so measuring this plan against them
    // would report zero however much was studied.
    const result = planProgress(
      base({
        plan: {
     targetType: "SESSIONS",
          category: "STUDY",
          targetValue: 6,
    status: "ACTIVE",
        },
 habits: [
          habitLog("2026-09-28"),
          habitLog("2026-09-29"),
     habitLog("2026-09-30"),
   ],
focusSessions: [
          session("2026-09-28T09:00:00.000Z", 3600),
          session("2026-09-29T09:00:00.000Z", 1800),
   session("2026-09-30T09:00:00.000Z", 900),
        ],
      }),
    );
    expect(result.actual).toBe(3);
    expect(result.unit).toBe("sessions");
  });

  it("does not count a study session that has not finished", () => {
    // A running session is not yet a session, and counting it would make the figure
    // jump on its own when the timer stops.
    const result = planProgress(
      base({
        plan: {
          targetType: "SESSIONS",
      category: "STUDY",
          targetValue: 6,
          status: "ACTIVE",
        },
        focusSessions: [
   session("2026-09-28T09:00:00.000Z", 0, false),
    session("2026-09-29T09:00:00.000Z", 3600),
        ],
      }),
    );
    expect(result.actual).toBe(1);
  });

  it("does not count a study session with no task, which cannot be attributed", () => {
    const unattributed: PlanFocusSessionInput = {
      taskId: null,
      startedAt: new Date("2026-09-28T09:00:00.000Z"),
      actualSeconds: 3600,
      ended: true,
    };
    const result = planProgress(
 base({
        plan: {
          targetType: "SESSIONS",
category: "STUDY",
          targetValue: 6,
       status: "ACTIVE",
        },
        focusSessions: [unattributed],
      }),
    );
    expect(result.actual).toBe(0);
  });

  it("excludes sessions outside the window from a study plan", () => {
    const result = planProgress(
      base({
        plan: {
          targetType: "SESSIONS",
          category: "STUDY",
          targetValue: 6,
   status: "ACTIVE",
        },
        focusSessions: [
          session("2026-09-25T09:00:00.000Z", 3600),
          session("2026-10-05T09:00:00.000Z", 3600),
      session("2026-10-04T09:00:00.000Z", 3600),
    ],
      }),
    );
    // Only the final day counts: the range is half-open and the end date is
    // inclusive, so an instant on the 4th is inside the window and the 5th is not.
    expect(result.actual).toBe(1);
  });

  it("refuses to measure SESSIONS on a category with no session table behind it", () => {
    // Better a stated refusal than a confident zero. A work plan measured in sessions
    // would otherwise read as a missed week with no explanation anywhere.
    const result = planProgress(
      base({
        plan: {
targetType: "SESSIONS",
          category: "WORK",
          targetValue: 6,
    status: "ACTIVE",
        },
        habits: [habitLog("2026-09-28"), habitLog("2026-09-29")],
        focusSessions: [session("2026-09-28T09:00:00.000Z", 3600)],
      }),
    );
    expect(result.measurable).toBe(false);
    expect(result.actual).toBe(0);
  expect(result.reason).toMatch(/only measured for study and fitness/i);
  });

  it("says so plainly when a SESSIONS plan is unmeasurable, not merely empty", () => {
    // The distinction matters: "add your own count" invites the user to type a
    // number, whereas this combination should never have been creatable at all.
    const result = planProgress(
      base({
        plan: {
          targetType: "SESSIONS",
          category: "PERSONAL",
    targetValue: 3,
     status: "ACTIVE",
        },
      }),
    );
    expect(result.reason).toMatch(/change the target type/i);
  });

  it("measures TASKS from completed linked tasks", () => {
    const result = planProgress(
      base({
        plan: { targetType: "TASKS", category: "CUSTOM", targetValue: 20, status: "ACTIVE" },
        tasks: [
          { id: "a", status: "DONE", completedAt: TUESDAY },
          { id: "b", status: "IN_PROGRESS", completedAt: null },
        ],
      }),
    );
    expect(result.actual).toBe(1);
    expect(result.unit).toBe("tasks");
  });

  it("reads a manual count for a COUNT plan and marks it unmeasurable", () => {
    const result = planProgress(
      base({
        plan: { targetType: "COUNT", category: "CUSTOM", targetValue: 300, status: "ACTIVE" },
        manualActual: 120,
      }),
    );
    expect(result.actual).toBe(120);
    expect(result.measurable).toBe(false);
    expect(result.reason).toMatch(/cannot measure/i);
  });

  it("treats an unreported COUNT as unknown, not as zero progress", () => {
    const result = planProgress(
      base({ plan: { targetType: "COUNT", category: "CUSTOM", targetValue: 300, status: "ACTIVE" } }),
    );
    expect(result.actual).toBe(0);
    expect(result.reason).toMatch(/add your own count/i);
  });

  it("explains an empty HOURS plan instead of showing a bare 0%", () => {
    const result = planProgress(base());
    expect(result.actual).toBe(0);
    expect(result.reason).toMatch(/no focus time logged/i);
  });

  it("gives no reason once there is something to show", () => {
    const result = planProgress(
      base({ focusSessions: [session("2026-09-28T09:00:00.000Z", 600)] }),
    );
    expect(result.reason).toBe("");
  });

  it("reports the calendar position and the gap between actual and pace", () => {
    const result = planProgress(
      base({
        plan: { targetType: "HOURS", category: "CUSTOM", targetValue: 10, status: "ACTIVE" },
        focusSessions: [session("2026-09-28T09:00:00.000Z", 7200)],
      }),
    );
    // 2 hours on day 2 of a 10 hour plan: 20% done against ~28.6% elapsed.
    expect(result.elapsed).toBe(2);
    expect(result.totalDays).toBe(7);
    expect(result.remainingDays).toBe(5);
    expect(result.percent).toBeCloseTo(0.2, 5);
    expect(result.aheadBy).toBeCloseTo(0.2 - 2 / 7, 5);
    expect(result.aheadBy!).toBeLessThan(0);
  });

  it("leaves aheadBy null when the window has not opened", () => {
    const result = planProgress(
      base({
        today: new Date("2026-09-27T00:00:00.000Z"),
        focusSessions: [session("2026-09-28T09:00:00.000Z", 3600)],
      }),
    );
    expect(result.elapsed).toBe(0);
    expect(result.pace).toBeNull();
    expect(result.aheadBy).toBeNull();
  });

  it("rounds to one decimal to keep float noise out of the UI", () => {
    const result = planProgress(
      base({
        plan: { targetType: "HOURS", category: "CUSTOM", targetValue: 7.3, status: "ACTIVE" },
        focusSessions: [session("2026-09-28T09:00:00.000Z", 7500)],
      }),
    );
    expect(result.actual).toBe(2.1);
    expect(result.target).toBe(7.3);
    expect(result.remaining).toBe(5.2);
  });

  it("passes an ARCHIVED plan's status through untouched", () => {
    const result = planProgress(
      base({ plan: { targetType: "HOURS", category: "CUSTOM", targetValue: 5, status: "ARCHIVED" } }),
    );
    expect(result.status).toBe("ARCHIVED");
  });
});

describe("paceLabel", () => {
  const withProgress = (
    targetType: PlanTargetType,
    targetValue: number,
    overrides: Partial<Parameters<typeof planProgress>[0]> = {},
  category: PlanCategory = "CUSTOM",
  ) => {
    // The plan is rebuilt here, so `category` used to be silently dropped and every
    // caller inherited `base`'s default. It is now an explicit parameter with the
    // same default, so a category-sensitive case states its category rather than
    // appearing to set one and quietly not using it.
    const { plan: _ignored, ...rest } = overrides;
    return paceLabel(
      planProgress(
        base({ ...rest, plan: { targetType, category, targetValue, status: "ACTIVE" } }),
      ),
    );
  };

  it("says the plan is measured by the user for a COUNT target", () => {
    expect(withProgress("COUNT", 300)).toBe("Measured by you");
  });

  it("says not started on day zero", () => {
    expect(
      withProgress("HOURS", 5, {
        today: new Date("2026-09-27T00:00:00.000Z"),
      }),
    ).toBe("Not started");
  });

  it("says no target set rather than guessing at progress", () => {
    expect(withProgress("HOURS", 0)).toBe("No target set");
  });

  it("calls an unfinished past window ended short", () => {
    expect(
      withProgress("HOURS", 10, { today: new Date("2026-10-06T00:00:00.000Z") }),
    ).toBe("Ended short");
  });

  it("calls a met past window met", () => {
    expect(
      withProgress("HOURS", 1, {
        today: new Date("2026-10-06T00:00:00.000Z"),
        focusSessions: [session("2026-09-28T09:00:00.000Z", 7200)],
      }),
    ).toBe("Met");
  });

  it("flags a plan running behind the calendar", () => {
    expect(
      withProgress("HOURS", 20, { focusSessions: [session("2026-09-28T09:00:00.000Z", 3600)] }),
    ).toBe("Behind pace");
  });

  it("stays quiet for a plan sitting exactly on pace", () => {
    // Day 2 of 7 means 2/7 of the window is gone, so a 7 hour target with 2 hours
    // done is exactly on pace. The 10-point cushion exists so an on-pace plan is
    // not flagged, which would train people to ignore the flag.
    const result = planProgress(
      base({
        plan: { targetType: "HOURS", category: "CUSTOM", targetValue: 7, status: "ACTIVE" },
        focusSessions: [session("2026-09-28T09:00:00.000Z", 7200)],
      }),
    );
    expect(result.percent).toBeCloseTo(2 / 7, 5);
    expect(result.aheadBy).toBeCloseTo(0, 5);
    expect(paceLabel(result)).toBe("On pace");
  });

  it("stays quiet while a small shortfall is inside the cushion", () => {
    // 2 hours against a 10 hour target on day 2 is 20% done against 28.6% gone.
    // The 8.6 point gap sits inside the cushion, so this is not flagged — the same
    // trade as in goals/page.tsx, where flagging on-pace goals trains people to
    // ignore the flag.
    const result = planProgress(
      base({
        plan: { targetType: "HOURS", category: "CUSTOM", targetValue: 10, status: "ACTIVE" },
        focusSessions: [session("2026-09-28T09:00:00.000Z", 7200)],
      }),
    );
    expect(result.aheadBy).toBeCloseTo(0.2 - 2 / 7, 5);
    expect(paceLabel(result)).toBe("On pace");
  });

  it("flags a plan whose shortfall is outside the cushion", () => {
    // 2 hours against a 20 hour target on day 2 is 10% done against 28.6% gone,
    // an 18.6 point gap — genuinely behind.
    const result = planProgress(
      base({
        plan: { targetType: "HOURS", category: "CUSTOM", targetValue: 20, status: "ACTIVE" },
        focusSessions: [session("2026-09-28T09:00:00.000Z", 7200)],
      }),
    );
    expect(paceLabel(result)).toBe("Behind pace");
  });

  it("flags a plan running ahead of the calendar", () => {
    const result = planProgress(
      base({
        plan: { targetType: "HOURS", category: "CUSTOM", targetValue: 5, status: "ACTIVE" },
        focusSessions: [session("2026-09-28T09:00:00.000Z", 14400)],
      }),
    );
    // 4 hours against a 5 hour target on day 2 is 80% done against 28.6% gone.
    expect(paceLabel(result)).toBe("Ahead of pace");
  });
});

describe("estimatedHoursFromTasks", () => {
  it("sums task estimates into hours", () => {
    expect(
      estimatedHoursFromTasks([
        { estimatedMinutes: 90 },
        { estimatedMinutes: 30 },
      ]),
    ).toBe(2);
  });

  it("treats a task with no estimate as zero rather than NaN", () => {
    expect(estimatedHoursFromTasks([{ estimatedMinutes: null }])).toBe(0);
  });

  it("returns 0 for an empty plan", () => {
    expect(estimatedHoursFromTasks([])).toBe(0);
  });
});