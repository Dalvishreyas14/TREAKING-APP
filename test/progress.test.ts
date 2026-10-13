import { describe, expect, it } from "vitest";

import {
  goalWorkProgress,
  hierarchyRollup,
  momentum,
  progressFromTasks,
} from "@/lib/progress";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("goalWorkProgress", () => {
  it("returns null, not 0, when there is nothing to measure", () => {
    const result = goalWorkProgress({
      statedPercent: 0,
      tasks: [],
      milestones: [],
    });

    // 0 would assert "nothing is done"; null says "no work attached yet".
    expect(result.derivedPercent).toBeNull();
    expect(result.driftFromStated).toBeNull();
    expect(result.isDrifting).toBe(false);
  });

  it("falls back to task progress when there are no milestones", () => {
    const result = goalWorkProgress({
      statedPercent: 0,
      tasks: [{ status: "DONE" }, { status: "TODO" }, { status: "TODO" }, { status: "TODO" }],
      milestones: [],
    });

    expect(result.tasksPercent).toBe(25);
    expect(result.derivedPercent).toBe(25);
  });

  it("falls back to milestone progress when there are no tasks", () => {
    const result = goalWorkProgress({
      statedPercent: 0,
      tasks: [],
      milestones: [{ status: "DONE" }, { status: "PENDING" }],
    });

    expect(result.milestonesPercent).toBe(50);
    expect(result.derivedPercent).toBe(50);
  });

  it("weights milestones above tasks when both exist", () => {
    // tasks 0%, milestones 100% => 0*0.4 + 100*0.6 = 60
    const result = goalWorkProgress({
      statedPercent: 0,
      tasks: [{ status: "TODO" }],
      milestones: [{ status: "DONE" }],
    });

    expect(result.tasksPercent).toBe(0);
    expect(result.milestonesPercent).toBe(100);
    expect(result.derivedPercent).toBe(60);
  });

  it("keeps cancelled and archived tasks in the denominator", () => {
    const result = goalWorkProgress({
      statedPercent: 0,
      tasks: [
        { status: "DONE" },
        { status: "CANCELLED" },
        { status: "ARCHIVED" },
        { status: "TODO" },
      ],
      milestones: [],
    });

    // Dropping the cancelled pair would report 100% instead.
    expect(result.tasksTotal).toBe(4);
    expect(result.tasksDone).toBe(1);
    expect(result.tasksPercent).toBe(25);
  });

  it("counts subtasks in the same pool as top-level tasks", () => {
    // The caller flattens the tree; the engine must not special-case depth.
    const result = goalWorkProgress({
      statedPercent: 0,
      tasks: [{ status: "DONE" }, { status: "TODO" }],
      milestones: [],
    });
    expect(result.derivedPercent).toBe(50);
  });

  it("flags drift only once it passes the threshold", () => {
    // stated 45 against a derived 33 is a 12-point gap, inside the threshold.
    const underThreshold = goalWorkProgress({
      statedPercent: 45,
      tasks: [{ status: "DONE" }, { status: "TODO" }, { status: "TODO" }],
      milestones: [],
    });
    expect(underThreshold.derivedPercent).toBe(33);
    expect(underThreshold.driftFromStated).toBe(12);
    expect(underThreshold.isDrifting).toBe(false);

    // stated 80 against the same derived 33 is a 47-point gap.
    const overThreshold = goalWorkProgress({
      statedPercent: 80,
      tasks: [{ status: "DONE" }, { status: "TODO" }, { status: "TODO" }],
      milestones: [],
    });
    expect(overThreshold.driftFromStated).toBe(47);
    expect(overThreshold.isDrifting).toBe(true);
  });

  it("flags a large gap in either direction", () => {
    const overStated = goalWorkProgress({
      statedPercent: 0,
      tasks: [{ status: "DONE" }],
      milestones: [],
    });
    expect(overStated.driftFromStated).toBe(-100);
    expect(overStated.isDrifting).toBe(true);
  });
});

describe("momentum", () => {
  it("reports unknown with no completions at all", () => {
    const result = momentum({ tasks: [], focusSessions: [], now: NOW });
    expect(result.direction).toBe("unknown");
    expect(result.ratio).toBeNull();
  });

  it("compares the trailing week against the week before it", () => {
    const result = momentum({
      now: NOW,
      focusSessions: [],
      tasks: [
        { status: "DONE", completedAt: daysAgo(1) },
        { status: "DONE", completedAt: daysAgo(2) },
        { status: "DONE", completedAt: daysAgo(3) },
        { status: "DONE", completedAt: daysAgo(10) },
      ],
    });

    expect(result.completedRecent).toBe(3);
    expect(result.completedPrior).toBe(1);
    expect(result.ratio).toBe(3);
    expect(result.direction).toBe("up");
  });

  it("treats ordinary noise as flat", () => {
    // 7 in the trailing week against 7 the week before: a ratio of exactly 1.
    const days = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => ({
        status: "DONE",
        completedAt: daysAgo(from + i),
      }));

    const result = momentum({
      tasks: [...days(1, 7), ...days(8, 14)],
      focusSessions: [],
      now: NOW,
    });

    expect(result.completedRecent).toBe(7);
    expect(result.completedPrior).toBe(7);
    expect(result.ratio).toBe(1);
    expect(result.direction).toBe("flat");
  });

  it("ignores completions older than both windows", () => {
    const result = momentum({
      tasks: [{ status: "DONE", completedAt: daysAgo(40) }],
      focusSessions: [],
      now: NOW,
    });

    expect(result.completedRecent).toBe(0);
    expect(result.completedPrior).toBe(0);
    expect(result.direction).toBe("unknown");
  });

  it("reports up without inventing a ratio when the prior window was empty", () => {
    const result = momentum({
      tasks: [{ status: "DONE", completedAt: daysAgo(1) }],
      focusSessions: [],
      now: NOW,
    });

    expect(result.completedPrior).toBe(0);
    expect(result.ratio).toBeNull();
    expect(result.direction).toBe("up");
  });

  it("ignores tasks that are not actually done", () => {
    const result = momentum({
      tasks: [{ status: "TODO", completedAt: daysAgo(1) }],
      focusSessions: [],
      now: NOW,
    });
    expect(result.completedRecent).toBe(0);
  });

  it("ignores a done task with no completion date", () => {
    // A DONE task with a null completedAt would otherwise land at epoch 0 and
    // fall outside every window, but it must not be counted as recent.
    const result = momentum({
      tasks: [{ status: "DONE", completedAt: null }],
      focusSessions: [],
      now: NOW,
    });
    expect(result.completedRecent).toBe(0);
    expect(result.completedPrior).toBe(0);
  });

  it("sums focus time in minutes, not session counts", () => {
    const result = momentum({
      tasks: [],
      now: NOW,
      focusSessions: [
        { startedAt: new Date(daysAgo(1)), actualSeconds: 1500 },
        { startedAt: new Date(daysAgo(2)), actualSeconds: 0 },
      ],
    });

    // 1500s is 25 minutes. This used to assert 1, because the field was fed by
    // the same function that counts rows - so a 25-minute session read as "1 min
    // focused" and every screen quoting it was wrong by a factor of 25.
    expect(result.focusMinutesRecent).toBe(25);
  });

  it("adds up several sessions in the same window", () => {
    const result = momentum({
      tasks: [],
      now: NOW,
      focusSessions: [
        { startedAt: new Date(daysAgo(1)), actualSeconds: 1800 },
        { startedAt: new Date(daysAgo(3)), actualSeconds: 1200 },
        { startedAt: new Date(daysAgo(4)), actualSeconds: 600 },
      ],
    });

    // 30 + 20 + 10 minutes. Counting sessions would report 3.
    expect(result.focusMinutesRecent).toBe(60);
  });

  it("keeps a zero-length session out of the minutes total", () => {
    const result = momentum({
      tasks: [],
      now: NOW,
      focusSessions: [
        { startedAt: new Date(daysAgo(1)), actualSeconds: 1200 },
        { startedAt: new Date(daysAgo(1)), actualSeconds: 0 },
      ],
    });

    expect(result.focusMinutesRecent).toBe(20);
  });

  it("separates recent focus from the prior window", () => {
    const result = momentum({
      tasks: [],
      now: NOW,
      focusSessions: [
        { startedAt: new Date(daysAgo(1)), actualSeconds: 600 },
        { startedAt: new Date(daysAgo(8)), actualSeconds: 1800 },
      ],
    });

    expect(result.focusMinutesRecent).toBe(10);
    expect(result.focusMinutesPrior).toBe(30);
  });
});

describe("hierarchyRollup", () => {
  it("excludes unmeasured goals from the overall derived average", () => {
    const result = hierarchyRollup([
      {
        id: "g1",
        progress: 100,
        tasks: [{ status: "DONE" }],
        milestones: [],
        projects: [],
      },
      {
        id: "g2",
        progress: 0,
        tasks: [],
        milestones: [],
        projects: [],
      },
    ]);

    // A flat 50 would claim the untouched goal is half done.
    expect(result.overall.derivedPercent).toBe(100);
    expect(result.overall.statedPercent).toBe(50);
  });

  it("derives project progress through the shared project helper", () => {
    const result = hierarchyRollup([
      {
        id: "g1",
        progress: 0,
        tasks: [{ status: "DONE" }],
        milestones: [],
        projects: [
          {
            id: "p1",
            name: "Ship it",
            tasks: [{ task: { status: "DONE" } }, { task: { status: "TODO" } }],
          },
        ],
      },
    ]);

    expect(result.goals[0]!.projects[0]!.progress).toEqual(
      progressFromTasks([
        { task: { status: "DONE" } },
        { task: { status: "TODO" } },
      ]),
    );
  });

  it("counts how many goals are drifting", () => {
    const result = hierarchyRollup([
      // stated 90, all tasks still open -> drifts hard.
      { id: "a", progress: 90, tasks: [{ status: "TODO" }], milestones: [], projects: [] },
      // stated 100 and the single task is done -> agrees exactly.
      { id: "b", progress: 100, tasks: [{ status: "DONE" }], milestones: [], projects: [] },
    ]);

    expect(result.overall.drifting).toBe(1);
    expect(result.goals.find((g) => g.id === "a")!.progress.isDrifting).toBe(true);
    expect(result.goals.find((g) => g.id === "b")!.progress.isDrifting).toBe(false);
  });

  it("handles no goals at all", () => {
    const result = hierarchyRollup([]);
    expect(result.overall.derivedPercent).toBeNull();
    expect(result.overall.statedPercent).toBe(0);
  });
});
