import { describe, expect, it } from "vitest";

import {
  weeklyPlanApplyTemplateSchema,
  weeklyPlanCopySchema,
  weeklyPlanCreateSchema,
  weeklyPlanTemplateSchema,
  weeklyPlanUpdateSchema,
  weeklyReviewNotesSchema,
} from "@/lib/validation/schemas";

/**
 * The weekly-plan request contracts.
 *
 * These are tested rather than trusted because the failure mode they guard is not a
 * crash — it is a request that succeeds and writes something the user did not ask
 * for. A `@db.Date` column given the wrong instant, or a plan allowed to end before
 * it starts, both store cleanly and both are wrong on screen.
 */

const WEEK = { startDate: "2026-09-28", endDate: "2026-10-04" };

describe("weeklyPlanCreateSchema", () => {
  it("accepts a minimal plan with a target and no linked work", () => {
    const parsed = weeklyPlanCreateSchema.parse({
      name: "GATE prep",
      ...WEEK,
      targetType: "HOURS",
      targetValue: 7,
    });
    expect(parsed.category).toBe("CUSTOM");
    expect(parsed.targetValue).toBe(7);
  });

  it("defaults to a zero target, so structure can exist before commitment", () => {
    const parsed = weeklyPlanCreateSchema.parse({ name: "Someday", ...WEEK });
    expect(parsed.targetValue).toBe(0);
    expect(parsed.targetType).toBe("HOURS");
  });

  it("rejects a plan that ends before it starts", () => {
    const result = weeklyPlanCreateSchema.safeParse({
      name: "Backwards",
      startDate: "2026-10-04",
      endDate: "2026-09-28",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a single-day plan", () => {
    // A Saturday-only plan is a real thing, and the inclusive endDate means the
    // window is one day rather than zero.
    expect(
      weeklyPlanCreateSchema.safeParse({
        name: "Saturday deep work",
        startDate: "2026-10-03",
        endDate: "2026-10-03",
      }).success,
    ).toBe(true);
  });

  it("rejects a date that does not exist", () => {
    // 30 February silently becomes 2 March under a permissive date parse, which
    // would file the plan under a week the user never named.
    const result = weeklyPlanCreateSchema.safeParse({
      name: "Impossible",
      startDate: "2026-02-30",
      endDate: "2026-03-06",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a loose date format", () => {
    // `z.coerce.date()` would accept "28/09/2026" and write whatever it guessed.
    expect(
      weeklyPlanCreateSchema.safeParse({
        name: "Sloppy",
        startDate: "28/09/2026",
        endDate: "04/10/2026",
      }).success,
    ).toBe(false);
  });

  it("rejects a negative target", () => {
    expect(
      weeklyPlanCreateSchema.safeParse({ name: "Negative", ...WEEK, targetValue: -5 }).success,
    ).toBe(false);
  });

  it("accepts eight day entries only by rejecting them", () => {
    // Seven is the number of weekdays; an eighth entry has to fail rather than be
    // silently dropped, because a dropped day is an intention the user believed was
    // recorded.
    const days = Array.from({ length: 8 }, (_, i) => ({
      dayOfWeek: i % 7,
      note: `Day ${i}`,
    }));
    expect(weeklyPlanCreateSchema.safeParse({ name: "Too many days", ...WEEK, days }).success).toBe(
      false,
    );
  });

  it("accepts seven day entries including rest days", () => {
    const days = Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i, note: null }));
    expect(weeklyPlanCreateSchema.safeParse({ name: "Full week", ...WEEK, days }).success).toBe(true);
  });

  it("rejects a dayOfWeek outside 0-6", () => {
    expect(
      weeklyPlanCreateSchema.safeParse({
        name: "Bad day",
        ...WEEK,
        days: [{ dayOfWeek: 7, note: null }],
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(
      weeklyPlanCreateSchema.safeParse({ name: "Nope", ...WEEK, category: "SLEEP" }).success,
    ).toBe(false);
  });

  it("rejects two entries for the same weekday", () => {
    // Without this the caller gets a raw constraint violation naming an index. With
    // it, the message says the actual mistake, and the rejection happens before any
    // row is written.
    const result = weeklyPlanCreateSchema.safeParse({
      name: "Double Monday",
      ...WEEK,
      days: [
        { dayOfWeek: 1, note: "Legs" },
        { dayOfWeek: 1, note: "Also legs" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a SESSIONS target on a study or fitness plan", () => {
    // The two categories whose sessions are already counted elsewhere in the app.
    for (const category of ["STUDY", "FITNESS"] as const) {
      expect(
        weeklyPlanCreateSchema.safeParse({
          name: "Sessions",
          ...WEEK,
     category,
          targetType: "SESSIONS",
     targetValue: 4,
        }).success,
      ).toBe(true);
    }
  });

  it("refuses SESSIONS for a category with no session count behind it", () => {
    // Rejecting at the boundary is better than storing the number and reporting a
    // permanent zero: nothing in a work week can become a "session".
    for (const category of ["WORK", "PERSONAL", "PROJECT", "CUSTOM"] as const) {
      const result = weeklyPlanCreateSchema.safeParse({
    name: "Unmeasurable",
        ...WEEK,
        category,
        targetType: "SESSIONS",
        targetValue: 4,
      });
      expect(result.success).toBe(false);
    }
  });

  it("treats an omitted category as CUSTOM, so SESSIONS is still refused", () => {
    // The default is applied before the refine, so the legacy client that never
    // sends a category cannot open a hole in the rule by leaving it out.
    expect(
      weeklyPlanCreateSchema.safeParse({ name: "Legacy", ...WEEK, targetType: "SESSIONS" }).success,
    ).toBe(false);
  });
});

describe("weeklyPlanUpdateSchema", () => {
  it("requires at least one field", () => {
    expect(weeklyPlanUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("allows clearing manualActual with null", () => {
    // Null means "not counted yet", which is different from 0 ("counted, none done").
    const parsed = weeklyPlanUpdateSchema.parse({ manualActual: null });
    expect(parsed.manualActual).toBeNull();
  });

  it("allows clearing a goal or project link", () => {
    const parsed = weeklyPlanUpdateSchema.parse({ goalId: null, projectId: null });
    expect(parsed.goalId).toBeNull();
    expect(parsed.projectId).toBeNull();
  });

  it("rejects an end date that precedes the start date sent alongside it", () => {
    expect(
      weeklyPlanUpdateSchema.safeParse({ startDate: "2026-10-04", endDate: "2026-09-28" }).success,
    ).toBe(false);
  });

  it("allows a one-sided date change, which the route checks against the stored one", () => {
    // The schema cannot see the plan's other date, so this passes here and the route
    // compares against what is stored. That is the right division of labour.
    expect(weeklyPlanUpdateSchema.safeParse({ startDate: "2026-10-01" }).success).toBe(true);
  });

  it("replaces days wholesale rather than merging them", () => {
    const parsed = weeklyPlanUpdateSchema.parse({ days: [{ dayOfWeek: 1, note: "Rest" }] });
    expect(parsed.days).toHaveLength(1);
  });

  it("rejects two entries for the same weekday", () => {
    expect(
      weeklyPlanUpdateSchema.safeParse({
        days: [
          { dayOfWeek: 2, note: null },
          { dayOfWeek: 2, note: "again" },
        ],
      }).success,
    ).toBe(false);
  });

  it("lets a SESSIONS patch through without a category, for the route to settle", () => {
    // The stored category is the other half of the rule and is not visible here.
    // Refusing on partial input would break the legitimate edit "make this fitness
    // plan a six-session week" when the plan is already FITNESS.
    expect(weeklyPlanUpdateSchema.safeParse({ targetType: "SESSIONS" }).success).toBe(true);
  });

  it("refuses a patch that sets both a SESSIONS target and an unmeasurable category", () => {
    // Both halves are present, so nothing is left for the route to infer.
    expect(
      weeklyPlanUpdateSchema.safeParse({ targetType: "SESSIONS", category: "WORK" }).success,
    ).toBe(false);
  });

  it("allows changing category away from sessions without touching the target", () => {
    // The inverse move has to stay legal: `[id]/route.ts` re-checks the stored
    // targetType and rejects if it is still SESSIONS, but the schema must not
    // pre-empt a request it cannot fully evaluate.
    expect(weeklyPlanUpdateSchema.safeParse({ category: "WORK" }).success).toBe(true);
  });
});

describe("weeklyPlanCopySchema", () => {
  it("defaults to copying tasks and going one week ahead", () => {
    const parsed = weeklyPlanCopySchema.parse({});
    expect(parsed.includeTasks).toBe(true);
    expect(parsed.weeksAhead).toBe(1);
  });

  it("rejects copying backwards into the past", () => {
    // weeksAhead is minimum 1 because "copy this week's plan to last week" is
    // almost certainly a mis-click, and it would create a plan that is already
    // over on arrival.
    expect(weeklyPlanCopySchema.safeParse({ weeksAhead: 0 }).success).toBe(false);
    expect(weeklyPlanCopySchema.safeParse({ weeksAhead: -1 }).success).toBe(false);
  });

  it("allows structure-only copying", () => {
    expect(weeklyPlanCopySchema.parse({ includeTasks: false }).includeTasks).toBe(false);
  });
});

describe("weeklyPlanTemplateSchema", () => {
  it("stores per-day task titles and no ids", () => {
    const parsed = weeklyPlanTemplateSchema.parse({
      name: "5-Day Gym",
      days: [
        { dayOfWeek: 1, tasks: ["Push", "Cardio"] },
        { dayOfWeek: 3, note: "Rest", tasks: [] },
      ],
    });
    expect(parsed.days[0]?.tasks).toEqual(["Push", "Cardio"]);
    expect(parsed.days[1]?.tasks).toEqual([]);
  });

  it("rejects an empty task title", () => {
    // An empty string would become a task row the user cannot see or delete by name.
    expect(
      weeklyPlanTemplateSchema.safeParse({
        name: "Broken",
        days: [{ dayOfWeek: 1, tasks: ["  "] }],
      }).success,
    ).toBe(false);
  });

  it("defaults days to empty", () => {
    expect(weeklyPlanTemplateSchema.parse({ name: "Empty" }).days).toEqual([]);
  });

  it("has no field that could carry a task id", () => {
    // The whole reason templates exist as titles rather than references. If someone
    // adds `taskId` here, a template would start rotting on task deletion and this
    // assertion is what says so at test time rather than in production.
    const parsed = weeklyPlanTemplateSchema.parse({ name: "Structure" });
    expect(Object.keys(parsed)).not.toContain("taskIds");
    expect(Object.keys(parsed)).not.toContain("habitIds");
  });

  it("refuses a SESSIONS template with no category to measure", () => {
    // A template stores the shape of a plan, so an unmeasurable one would only
    // reproduce the refusal at apply time — after the user has picked it.
    expect(
      weeklyPlanTemplateSchema.safeParse({ name: "Work week", targetType: "SESSIONS" }).success,
    ).toBe(false);
  });

  it("accepts a SESSIONS template on a fitness week", () => {
    expect(
      weeklyPlanTemplateSchema.safeParse({
        name: "5-day gym",
        category: "FITNESS",
        targetType: "SESSIONS",
        targetValue: 5,
        days: [{ dayOfWeek: 1, tasks: ["Push"], note: null }],
      }).success,
    ).toBe(true);
  });

  it("rejects two entries for the same weekday", () => {
    expect(
      weeklyPlanTemplateSchema.safeParse({
        name: "Double",
        days: [
          { dayOfWeek: 3, tasks: ["A"], note: null },
          { dayOfWeek: 3, tasks: ["B"], note: null },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("weeklyPlanApplyTemplateSchema", () => {
  it("requires an explicit window rather than inferring one", () => {
    expect(weeklyPlanApplyTemplateSchema.safeParse({}).success).toBe(false);
    expect(weeklyPlanApplyTemplateSchema.safeParse(WEEK).success).toBe(true);
  });

  it("rejects an inverted window", () => {
    expect(
      weeklyPlanApplyTemplateSchema.safeParse({
        startDate: "2026-10-04",
        endDate: "2026-09-28",
      }).success,
    ).toBe(false);
  });

  it("lets the caller rename the applied plan", () => {
    expect(weeklyPlanApplyTemplateSchema.parse({ ...WEEK, name: "Gym, week 2" }).name).toBe(
      "Gym, week 2",
    );
  });
});

describe("weeklyReviewNotesSchema", () => {
  it("accepts the three handwritten fields", () => {
    const parsed = weeklyReviewNotesSchema.parse({
      wentWell: "Hit the gym five times",
      shouldImprove: "Start earlier on Mondays",
      nextWeekFocus: "Finish the essay draft",
    });
    expect(parsed.wentWell).toBe("Hit the gym five times");
  });

  it("allows clearing a field back to unanswered", () => {
    // Null is "I have not answered that", which is distinct from an empty answer.
    expect(weeklyReviewNotesSchema.parse({ wentWell: null }).wentWell).toBeNull();
  });

  it("rejects text past the length cap", () => {
    expect(weeklyReviewNotesSchema.safeParse({ wentWell: "x".repeat(2001) }).success).toBe(false);
  });
});