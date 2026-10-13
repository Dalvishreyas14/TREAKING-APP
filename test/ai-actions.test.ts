import { describe, expect, it } from "vitest";

import {
  formatMinutesOfDay,
  planAction,
  type ActionContext,
  type ActionHabit,
  type ActionTask,
} from "@/lib/ai/actions";
import { addDaysUtc, dateOnlyLocal } from "@/lib/date";

/**
 * The action executor's planner.
 *
 * Every case here is a "what if the world moved between generating the insight
 * and tapping apply" case, because that is the failure the design exists to
 * prevent: an insight stores the argument for a change, not the result, so by the
 * time anyone reads it the rows it names have usually been edited.
 *
 * Assertions are made against the `ActionWrite` values rather than the rendered
 * diff. The diff contains locale-formatted dates, and a test that hard-codes
 * "Mon 8:00 PM" passes in IST and fails in UTC — which is exactly the class of
 * bug `src/lib/date.ts` exists to prevent, so the tests should not commit it.
 */

const NOW = new Date("2026-03-10T09:00:00.000Z");

function task(overrides: Partial<ActionTask> = {}): ActionTask {
  return {
    id: "task-1",
    title: "Review the deck",
    status: "TODO",
    priority: "MEDIUM",
    importance: 3,
    dueAt: new Date("2026-03-01T09:00:00.000Z"),
    startAt: null,
    snoozedUntil: null,
    estimatedMinutes: 30,
    createdAt: new Date("2026-02-01T09:00:00.000Z"),
    ...overrides,
  };
}

function habit(overrides: Partial<ActionHabit> = {}): ActionHabit {
  return {
    id: "habit-1",
    name: "Read 20 pages",
    isActive: true,
    archivedAt: null,
    frequency: "DAILY",
    difficulty: "MEDIUM",
    targetValue: 1,
    timesPerPeriod: null,
    preferredMinutes: 8 * 60,
    reminderEnabled: false,
    reminderMinutes: null,
    loggedDates: [],
    ...overrides,
  };
}

function context(overrides: Partial<ActionContext> = {}): ActionContext {
  return { now: NOW, tasks: [], habits: [], goals: [], profile: null, ...overrides };
}

function profile(overrides: Partial<{ sleepMinutes: number | null; wakeMinutes: number | null; availableWeekdayMinutes: number | null; availableWeekendMinutes: number | null }> = {}) {
  return {
    sleepMinutes: null,
    wakeMinutes: null,
    availableWeekdayMinutes: 240,
    availableWeekendMinutes: 240,
    ...overrides,
  };
}

describe("planAction", () => {
  it("refuses a kind it has no executor for, rather than guessing", () => {
    const { plan, writes } = planAction(context(), "FUTURE_KIND", {});
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/no automated change/i);
    expect(plan.changes).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("refuses an insight with no action at all", () => {
    const { plan } = planAction(context(), null, null);
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/observation/i);
  });

  it("never returns an applicable plan with nothing in it", () => {
    // The invariant the dialog depends on: if the UI offers a confirm button,
    // the confirm has something to do. Enforced over every spec, not per-case.
    const cases: [string, unknown, ActionContext][] = [
      ["LOG_HABIT", { habitId: "habit-1", date: "2026-03-10" }, context({ habits: [habit()] })],
      [
        "TRIAGE_OVERDUE",
        { taskIds: ["task-1"] },
        context({ tasks: [task()] }),
      ],
      [
        "ARCHIVE_STALE",
        { strategy: "oldest_first" },
        context({ tasks: [task({ dueAt: null, createdAt: new Date("2025-01-01T00:00:00Z") })] }),
      ],
      ["SUGGEST_SHORTER_POMODOROS", { minutes: 25 }, context()],
    ];

    for (const [kind, payload, ctx] of cases) {
      const { plan, writes } = planAction(ctx, kind, payload);
      if (plan.applicable) {
        expect(writes.length, `${kind} applicable with no writes`).toBeGreaterThan(0);
        expect(plan.changes.length, `${kind} applicable with an empty diff`).toBeGreaterThan(0);
        expect(plan.reason).toBeNull();
      } else {
        expect(plan.reason, `${kind} refused with no reason`).toBeTruthy();
        expect(writes).toEqual([]);
        expect(plan.changes).toEqual([]);
      }
    }
  });
});

describe("LOG_HABIT", () => {
  const payload = { habitId: "habit-1", date: "2026-03-10" };

  it("creates the log for a day with no entry", () => {
    const { plan, writes } = planAction(context({ habits: [habit()] }), "LOG_HABIT", payload);
    expect(plan.applicable).toBe(true);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]!.target).toBe("HabitLog");
    expect(plan.changes[0]!.before).toBeNull();
    expect(writes).toEqual([
      { op: "habit.log", habitId: "habit-1", date: "2026-03-10", value: 1, completed: true },
    ]);
  });

  it("uses the habit's target as the logged value, not a flat 1", () => {
    const { writes } = planAction(
      context({ habits: [habit({ targetValue: 20, frequency: "DAILY" })] }),
      "LOG_HABIT",
      payload,
    );
    expect(writes[0]).toMatchObject({ op: "habit.log", value: 20 });
  });

  it("refuses a day the user has already logged", () => {
    const { plan, writes } = planAction(
      context({ habits: [habit({ loggedDates: ["2026-03-10"] })] }),
      "LOG_HABIT",
      payload,
    );
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/already logged/i);
    expect(writes).toEqual([]);
  });

  it("refuses a habit that has since been deleted", () => {
    const { plan } = planAction(context(), "LOG_HABIT", payload);
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/no longer exists/i);
  });

  it("refuses a paused habit, because logging it is not what the user meant", () => {
    const { plan } = planAction(
      context({ habits: [habit({ isActive: false })] }),
      "LOG_HABIT",
      payload,
    );
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/paused/i);
  });
});

describe("TRIAGE_OVERDUE", () => {
  it("moves genuinely overdue tasks to 8pm today", () => {
    const { plan, writes } = planAction(
      context({ tasks: [task({ id: "a" }), task({ id: "b" })] }),
      "TRIAGE_OVERDUE",
      { taskIds: ["a", "b"] },
    );
    expect(plan.applicable).toBe(true);
    expect(writes).toHaveLength(2);
    for (const write of writes) {
      expect(write.op).toBe("task.update");
      const data = (write as { data: { dueAt: Date } }).data;
      // Local wall-clock 8pm, so the assertion reads the local fields back.
      expect(data.dueAt.getHours()).toBe(20);
      expect(data.dueAt.getDate()).toBe(dateOnlyLocal(NOW).getDate());
    }
  });

  it("leaves tasks that are already done or cancelled alone", () => {
    const { plan, writes } = planAction(
      context({
        tasks: [
          task({ id: "a", status: "DONE" }),
          task({ id: "b", status: "CANCELLED" }),
          task({ id: "c", status: "ARCHIVED" }),
        ],
      }),
      "TRIAGE_OVERDUE",
      { taskIds: ["a", "b", "c"] },
    );
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/done or rescheduled/i);
    expect(writes).toEqual([]);
  });

  it("leaves a snoozed task alone, because snoozing is the user saying later", () => {
    const { writes } = planAction(
      context({
        tasks: [task({ id: "a", snoozedUntil: new Date("2026-03-20T00:00:00Z") })],
      }),
      "TRIAGE_OVERDUE",
      { taskIds: ["a"] },
    );
    expect(writes).toEqual([]);
  });

  it("leaves a future task alone", () => {
    const { writes } = planAction(
      context({ tasks: [task({ id: "a", dueAt: new Date("2026-04-01T00:00:00Z") })] }),
      "TRIAGE_OVERDUE",
      { taskIds: ["a"] },
    );
    expect(writes).toEqual([]);
  });

  it("caps the set, so the diff stays something a person will read", () => {
    const many = Array.from({ length: 30 }, (_, i) => task({ id: `t${i}` }));
    const { plan, writes } = planAction(
      context({ tasks: many }),
      "TRIAGE_OVERDUE",
      { taskIds: many.map((t) => t.id) },
    );
    expect(writes).toHaveLength(8);
    // The summary has to say the number the dialog is about to show.
    expect(plan.summary).toContain("8");
  });

  it("ignores ids that are not in the user's context", () => {
    const { plan } = planAction(
      context({ tasks: [task({ id: "mine" })] }),
      "TRIAGE_OVERDUE",
      { taskIds: ["mine", "someone-elses"] },
    );
    expect(plan.applicable).toBe(true);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]!.targetId).toBe("mine");
  });
});

describe("ARCHIVE_STALE", () => {
  const old = { dueAt: null, startAt: null, createdAt: new Date("2025-06-01T00:00:00Z") };

  it("archives the oldest undated open tasks", () => {
    const { plan, writes } = planAction(
      context({
        tasks: [
          task({ id: "oldest", ...old }),
          task({ id: "newer", ...old, createdAt: new Date("2025-11-01T00:00:00Z") }),
        ],
      }),
      "ARCHIVE_STALE",
      { strategy: "oldest_first" },
    );
    expect(plan.applicable).toBe(true);
    expect(writes.map((w) => (w as { id: string }).id)).toEqual(["oldest", "newer"]);
    expect((writes[0] as { data: { status: string } }).data.status).toBe("ARCHIVED");
  });

  it("keeps anything that has a date on it", () => {
    const { writes } = planAction(
      context({ tasks: [task({ id: "dated", ...old, dueAt: new Date("2026-01-01T00:00:00Z") })] }),
      "ARCHIVE_STALE",
      { strategy: "oldest_first" },
    );
    expect(writes).toEqual([]);
  });

  it("keeps anything younger than a month", () => {
    const { writes } = planAction(
      context({ tasks: [task({ id: "fresh", ...old, createdAt: addDaysUtc(NOW, -10) })] }),
      "ARCHIVE_STALE",
      { strategy: "oldest_first" },
    );
    expect(writes).toEqual([]);
  });

  it("refuses a strategy it was not written for", () => {
    const { plan } = planAction(context(), "ARCHIVE_STALE", { strategy: "newest_first" });
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/does not implement/i);
  });
});

describe("RESCHEDULE_TASKS", () => {
  // 2026-03-11 is a Wednesday, so the weekday budget applies.
  const weekday = { availableWeekdayMinutes: 240, availableWeekendMinutes: 300 };

  function contextWithBudget(overrides: Partial<ActionContext> = {}): ActionContext {
    return context({ profile: profile(weekday), ...overrides });
  }

  it("refuses the weekday shape, which is advice and not a change", () => {
    const { plan, writes } = planAction(context(), "RESCHEDULE_TASKS", {
      day: 1,
      suggestion: "avoid_heavy_work",
    });
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/advice/i);
    expect(writes).toEqual([]);
  });

  it("moves only the tail that overflows the day's capacity", () => {
    // 2h of important work fits in a 4h day. The third task is what does not.
    const { plan, writes } = planAction(
      contextWithBudget({
        tasks: [
          task({ id: "important", importance: 5, estimatedMinutes: 120, dueAt: new Date("2026-03-11T09:00:00Z") }),
          task({ id: "also-important", importance: 4, estimatedMinutes: 120, dueAt: new Date("2026-03-11T11:00:00Z") }),
          task({ id: "the-tail", importance: 1, estimatedMinutes: 90, dueAt: new Date("2026-03-11T14:00:00Z") }),
        ],
      }),
      "RESCHEDULE_TASKS",
      { date: "2026-03-11", strategy: "move_lowest_priority" },
    );

    expect(plan.applicable).toBe(true);
    // The whole point: the day is left inside its budget, not emptied.
    expect(writes).toHaveLength(1);
    expect((writes[0] as { id: string }).id).toBe("the-tail");
    const dueAt = (writes[0] as { data: { dueAt: Date } }).data.dueAt;
    expect(dueAt.getTime()).toBeGreaterThan(new Date("2026-03-11T14:00:00Z").getTime());
  });

  it("uses the weekend budget at the weekend", () => {
    // 2026-03-14 is a Saturday. A 5h day fits 300 minutes, so the third task moves.
    const tasks = [
      task({ id: "a", importance: 5, estimatedMinutes: 180, dueAt: new Date("2026-03-14T09:00:00Z") }),
      task({ id: "b", importance: 4, estimatedMinutes: 120, dueAt: new Date("2026-03-14T11:00:00Z") }),
      task({ id: "c", importance: 1, estimatedMinutes: 60, dueAt: new Date("2026-03-14T14:00:00Z") }),
    ];
    const payload = { date: "2026-03-14", strategy: "move_lowest_priority" };

    const weekend = planAction(contextWithBudget({ tasks }), "RESCHEDULE_TASKS", payload);
    expect((weekend.writes[0] as { id: string }).id).toBe("c");

    // With the weekday budget instead, 180+120 already fits in 240 and 60 is the tail.
    const asWeekday = planAction(
      context({ profile: profile({ availableWeekdayMinutes: 240, availableWeekendMinutes: 120 }), tasks }),
      "RESCHEDULE_TASKS",
      payload,
    );
    expect((asWeekday.writes[0] as { id: string }).id).toBe("a");
  });

  it("refuses when the day already fits", () => {
    const { plan, writes } = planAction(
      contextWithBudget({
        tasks: [task({ estimatedMinutes: 30, dueAt: new Date("2026-03-11T09:00:00Z") })],
      }),
      "RESCHEDULE_TASKS",
      { date: "2026-03-11", strategy: "move_lowest_priority" },
    );
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/already fits/i);
    expect(writes).toEqual([]);
  });

  it("treats an unestimated task as costing nothing, so it is never the tail", () => {
    const { writes } = planAction(
      contextWithBudget({
        tasks: [
          task({ id: "big", importance: 5, estimatedMinutes: 240, dueAt: new Date("2026-03-11T09:00:00Z") }),
          task({ id: "unknown", importance: 1, estimatedMinutes: null, dueAt: new Date("2026-03-11T14:00:00Z") }),
        ],
      }),
      "RESCHEDULE_TASKS",
      { date: "2026-03-11", strategy: "move_lowest_priority" },
    );
    expect(writes).toEqual([]);
  });

  it("refuses when the day has been cleared since", () => {
    const { plan } = planAction(contextWithBudget({ tasks: [task()] }), "RESCHEDULE_TASKS", {
      date: "2026-03-11",
      strategy: "move_lowest_priority",
    });
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/nothing to move/i);
  });

  it("refuses an unparseable day rather than writing to an invalid date", () => {
    const { plan, writes } = planAction(context(), "RESCHEDULE_TASKS", {
      date: "next tuesday",
      strategy: "move_lowest_priority",
    });
    expect(plan.applicable).toBe(false);
    expect(writes).toEqual([]);
    expect(plan.reason).toBeTruthy();
  });
});

describe("ADJUST_HABIT", () => {
  it("lowers the target value first", () => {
    const { plan, writes } = planAction(
      context({ habits: [habit({ targetValue: 20, difficulty: "HARD" })] }),
      "ADJUST_HABIT",
      { habitId: "habit-1", suggestion: "lower_target" },
    );
    expect((writes[0] as { data: { targetValue: number } }).data.targetValue).toBe(15);
    expect(plan.changes[0]!.before).toBe("20");
  });

  it("never lowers a target below one, because zero is not a smaller goal", () => {
    const { writes } = planAction(
      context({ habits: [habit({ targetValue: 1, difficulty: "MEDIUM" })] }),
      "ADJUST_HABIT",
      { habitId: "habit-1", suggestion: "lower_target" },
    );
    // Target already 1, so it steps difficulty down instead.
    expect(writes[0]).toMatchObject({ op: "habit.update", data: { difficulty: "EASY" } });
  });

  it("refuses when there is nothing left to lower", () => {
    const { plan } = planAction(
      context({ habits: [habit({ targetValue: 1, difficulty: "EASY" })] }),
      "ADJUST_HABIT",
      { habitId: "habit-1", suggestion: "lower_target" },
    );
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/nothing left to lower/i);
  });
});

describe("SCHEDULE_HABIT", () => {
  it("turns on reminders for habits that have none, at their preferred time", () => {
    const { writes } = planAction(
      context({ habits: [habit({ preferredMinutes: 7 * 60 + 30 })] }),
      "SCHEDULE_HABIT",
      { habitIds: ["habit-1"] },
    );
    expect(writes[0]).toMatchObject({
      op: "habit.update",
      data: { reminderEnabled: true, reminderMinutes: 7 * 60 + 30 },
    });
  });

  it("falls back to a stated default when the habit has no preferred time", () => {
    const { writes } = planAction(
      context({ habits: [habit({ preferredMinutes: null })] }),
      "SCHEDULE_HABIT",
      { habitIds: ["habit-1"] },
    );
    expect(writes[0]).toMatchObject({ data: { reminderMinutes: 9 * 60 } });
  });

  it("skips habits that already remind, and refuses if none are left", () => {
    const { plan, writes } = planAction(
      context({ habits: [habit({ reminderEnabled: true })] }),
      "SCHEDULE_HABIT",
      { habitIds: ["habit-1"] },
    );
    expect(plan.applicable).toBe(false);
    expect(writes).toEqual([]);
  });
});

describe("SUGGEST_BEDTIME", () => {
  it("writes the suggested hours to the profile", () => {
    const { plan, writes } = planAction(
      context({ profile: { ...profile(), sleepMinutes: 24 * 60 - 90 } }),
      "SUGGEST_BEDTIME",
      { targetHours: 7.5 },
    );
    expect(writes[0]).toMatchObject({ op: "profile.update", data: { sleepMinutes: 450 } });
    expect(plan.changes[0]!.target).toBe("Profile");
  });

  it("refuses when the bedtime is already what was suggested", () => {
    const { plan, writes } = planAction(
      context({ profile: { ...profile(), sleepMinutes: 450 } }),
      "SUGGEST_BEDTIME",
      { targetHours: 7.5 },
    );
    expect(plan.applicable).toBe(false);
    expect(writes).toEqual([]);
    expect(plan.reason).toMatch(/already set/i);
  });

  it("refuses when there is no profile to write to", () => {
    const { plan } = planAction(context(), "SUGGEST_BEDTIME", { targetHours: 7.5 });
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/onboarding/i);
  });
});

describe("ADJUST_GOAL", () => {
  const goal = { id: "goal-1", title: "Ship v1", status: "ACTIVE", progress: 0.2 };

  it("pushes out a target date that has already passed", () => {
    const targetDate = new Date("2026-01-01T00:00:00Z");
    const { writes } = planAction(
      context({ goals: [{ ...goal, targetDate }] }),
      "ADJUST_GOAL",
      { goalId: "goal-1", suggestion: "extend_target_date" },
    );
    const next = (writes[0] as { data: { targetDate: Date } }).data.targetDate;
    expect(next.getTime()).toBeGreaterThan(targetDate.getTime());
  });

  it("refuses a goal that has not slipped yet", () => {
    const { plan } = planAction(
      context({ goals: [{ ...goal, targetDate: new Date("2027-01-01T00:00:00Z") }] }),
      "ADJUST_GOAL",
      { goalId: "goal-1", suggestion: "extend_target_date" },
    );
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/not slipped/i);
  });

  it("refuses the add-milestones shape rather than inventing milestone text", () => {
    const { plan, writes } = planAction(
      context({ goals: [{ ...goal, targetDate: new Date("2026-01-01T00:00:00Z") }] }),
      "ADJUST_GOAL",
      { goalId: "goal-1", suggestion: "add_milestones" },
    );
    expect(plan.applicable).toBe(false);
    expect(writes).toEqual([]);
    expect(plan.reason).toMatch(/yours to write/i);
  });

  it("refuses a goal with no target date", () => {
    const { plan } = planAction(
      context({ goals: [{ ...goal, targetDate: null }] }),
      "ADJUST_GOAL",
      { goalId: "goal-1", suggestion: "extend_target_date" },
    );
    expect(plan.applicable).toBe(false);
    expect(plan.reason).toMatch(/no target date/i);
  });
});

describe("advice with no writable home", () => {
  const kinds = ["SUGGEST_SHORTER_POMODOROS", "SUGGEST_FOCUS_WINDOW", "BREAK_DOWN_GOAL"];

  it("refuses with a reason that points somewhere real", () => {
    for (const kind of kinds) {
      const { plan, writes } = planAction(context(), kind, {});
      expect(plan.applicable, kind).toBe(false);
      expect(plan.reason, kind).toBeTruthy();
      expect(plan.reason!.length, kind).toBeGreaterThan(20);
      expect(writes, kind).toEqual([]);
    }
  });
});

describe("formatMinutesOfDay", () => {
  it("renders a wall-clock time for reminder values", () => {
    expect(formatMinutesOfDay(0)).toBe("12:00 AM");
    expect(formatMinutesOfDay(9 * 60 + 5)).toBe("9:05 AM");
    expect(formatMinutesOfDay(12 * 60)).toBe("12:00 PM");
    expect(formatMinutesOfDay(20 * 60 + 30)).toBe("8:30 PM");
    // 24:00 is stored as 0 for "midnight at the end of the day".
    expect(formatMinutesOfDay(24 * 60)).toBe("12:00 AM");
  });
});
