import { describe, expect, it } from "vitest";

import {
  suggestFromHistory,
  type RoutineHistoryRun,
  type RoutineHistoryStep,
} from "@/lib/routines/suggestions";

/**
 * History-based routine suggestions.
 *
 * Two things are being tested, and the second is the more important one. The
 * first is that each rule fires on the history it is meant to fire on. The second
 * is that every rule *stays quiet* otherwise — an app that tells a user their
 * two-run morning routine is failing is worse than one that says nothing, because
 * a wrong finding costs the credibility of the right ones that follow.
 *
 * Timestamps are local because the rules are local. The time-of-day rule buckets
 * by `getHours()`, which is the hour the user experienced, so these tests pin the
 * same local hours rather than converting from UTC.
 */

const NOW = new Date("2026-03-30T12:00:00");

const STEPS: RoutineHistoryStep[] = [
  { id: "s1", title: "Water", estimatedMinutes: 5 },
  { id: "s2", title: "Stretch", estimatedMinutes: 10 },
  { id: "s3", title: "Read", estimatedMinutes: 20 },
  { id: "s4", title: "Shower", estimatedMinutes: 15 },
];

interface RunSpec {
  /** Days before NOW. */
  daysAgo: number;
  hour: number;
  /** Minutes the run took; ignored when `open` is true. */
  minutes?: number;
  completedItems: number;
  totalItems?: number;
  open?: boolean;
}

function run(spec: RunSpec): RoutineHistoryRun {
  const startedAt = new Date(NOW);
  startedAt.setDate(startedAt.getDate() - spec.daysAgo);
  startedAt.setHours(spec.hour, 0, 0, 0);

  return {
    startedAt,
    completedAt: spec.open
      ? null
      : new Date(startedAt.getTime() + (spec.minutes ?? 30) * 60_000),
    completedItems: spec.completedItems,
    totalItems: spec.totalItems ?? 4,
  };
}

function ids(runs: RoutineHistoryRun[]): string[] {
  return suggestFromHistory(STEPS, runs, NOW).map((s) => s.id);
}

describe("suggestFromHistory sample discipline", () => {
  it("says nothing about a routine that has never been run", () => {
    expect(suggestFromHistory(STEPS, [], NOW)).toEqual([]);
  });

  it("says nothing after a single run", () => {
    // One run finished perfectly is not a pattern, and reporting it as one is how
    // a screen teaches a user not to believe it.
    expect(ids([run({ daysAgo: 1, hour: 7, minutes: 50, completedItems: 4 })])).toEqual([]);
  });

  it("says nothing after two runs", () => {
    expect(
      ids([
        run({ daysAgo: 1, hour: 7, minutes: 50, completedItems: 4 }),
        run({ daysAgo: 2, hour: 7, minutes: 50, completedItems: 4 }),
      ]),
    ).toEqual([]);
  });

  it("speaks once there are three closed runs", () => {
    const runs = [1, 2, 3].map((d) => run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 }));
    expect(suggestFromHistory(STEPS, runs, NOW).length).toBeGreaterThan(0);
  });
});

describe("completion", () => {
  it("flags a routine that is not getting finished", () => {
    const runs = [1, 2, 3, 4].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 2 }),
    );
    const [completion] = suggestFromHistory(STEPS, runs, NOW).filter(
      (s) => s.id === "completion",
    );

    expect(completion).toBeDefined();
    expect(completion!.evidence).toMatchObject({ closedRuns: 4, completedRuns: 0, finishRatePercent: 0 });
  });

  it("stays quiet when the routine is reliably finished", () => {
    // Nothing to fix, and the consistency rule carries the good news instead.
    const runs = [1, 2, 3, 4].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 }),
    );
    expect(ids(runs)).not.toContain("completion");
  });

  it("ignores open runs", () => {
    // A run that was never closed says nothing about whether the routine works.
    const runs = [
      ...[1, 2, 3].map((d) => run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 })),
      run({ daysAgo: 0, hour: 7, completedItems: 0, open: true }),
    ];
    const completion = suggestFromHistory(STEPS, runs, NOW).find((s) => s.id === "completion");
    expect(completion).toBeUndefined();
  });
});

describe("tail step", () => {
  it("names the step runs usually stop at", () => {
    // Every run stops after two steps, so the third is the one reached least.
    const runs = [1, 2, 3, 4, 5].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 20, completedItems: 2 }),
    );
    const tail = suggestFromHistory(STEPS, runs, NOW).find((s) => s.id === "tail-step");

    expect(tail?.title).toContain("Read");
    expect(tail?.evidence).toMatchObject({ stoppedAtStep: 3, steps: 4, runsStoppingThere: 5 });
  });

  it("stays quiet when runs reach the last step", () => {
    const runs = [1, 2, 3].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 3 }),
    );
    expect(ids(runs)).not.toContain("tail-step");
  });

  it("stays quiet for a single-step routine", () => {
    // A one-step routine has no step to stop at, so the inference has nothing to
    // name and would otherwise report "runs stop at step 1" for every run.
    const runs = [1, 2, 3].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 20, completedItems: 0, totalItems: 1 }),
    );
    expect(ids(runs)).not.toContain("tail-step");
  });

  it("stays quiet when the median is dominated by differing routine lengths", () => {
    // Two runs recorded against a five-step routine and one against a four-step
    // one. Comparing the raw counts would name a step on a routine that no longer
    // has that many steps.
    const runs = [
      run({ daysAgo: 1, hour: 7, completedItems: 2, totalItems: 5 }),
      run({ daysAgo: 2, hour: 7, completedItems: 2, totalItems: 5 }),
      run({ daysAgo: 3, hour: 7, completedItems: 3, totalItems: 4 }),
    ];
    expect(ids(runs)).not.toContain("tail-step");
  });
});

describe("pace", () => {
  it("flags runs that take longer than the step estimates add up to", () => {
    // Estimates total 50 minutes; these runs take 100.
    const runs = [1, 2, 3, 4].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 100, completedItems: 4 }),
    );
    const pace = suggestFromHistory(STEPS, runs, NOW).find((s) => s.id === "pace");

    expect(pace?.tone).toBe("info");
    expect(pace?.evidence).toMatchObject({ medianMinutes: 100, estimatedMinutes: 50, ratio: 2 });
  });

  it("praises runs that finish well inside the estimate", () => {
    // 35 against 50 estimated is a 0.7x ratio — clear enough to be worth saying.
    const runs = [1, 2, 3, 4].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 35, completedItems: 4 }),
    );
    const pace = suggestFromHistory(STEPS, runs, NOW).find((s) => s.id === "pace");

    expect(pace?.tone).toBe("praise");
  });

  it("stays quiet when the estimate is close enough", () => {
    // 55 against 50 estimated is a 1.1x ratio. True, and not worth a badge: the
    // estimate is doing its job and there is nothing to change.
    const runs = [1, 2, 3, 4].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 55, completedItems: 4 }),
    );
    expect(ids(runs)).not.toContain("pace");
  });

  it("does not claim a win when the runs match the estimate exactly", () => {
    // The failure mode this guards: "you beat your own estimate" for a run that
    // landed on the estimate to the minute.
    const runs = [1, 2, 3, 4].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 }),
    );
    expect(suggestFromHistory(STEPS, runs, NOW).map((s) => s.id)).not.toContain("pace");
  });

  it("stays quiet when the steps have no estimates", () => {
    // Nothing to compare against. Inventing a denominator here would produce a
    // confident, meaningless ratio.
    const bare: RoutineHistoryStep[] = STEPS.map((s) => ({ ...s, estimatedMinutes: null }));
    const runs = [1, 2, 3, 4].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 100, completedItems: 4 }),
    );
    expect(suggestFromHistory(bare, runs, NOW).map((s) => s.id)).not.toContain("pace");
  });
});

describe("consistency", () => {
  it("praises a routine run on most days", () => {
    const runs = Array.from({ length: 22 }, (_, i) =>
      run({ daysAgo: i, hour: 7, minutes: 50, completedItems: 4 }),
    );
    const consistency = suggestFromHistory(STEPS, runs, NOW).find(
      (s) => s.id === "consistency",
    );

    expect(consistency?.tone).toBe("praise");
  });

  it("warns about a routine that has gone quiet", () => {
    // Three runs, all older than the 30-day window.
    const runs = [45, 60, 80].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 }),
    );
    const consistency = suggestFromHistory(STEPS, runs, NOW).find(
      (s) => s.id === "consistency",
    );

    expect(consistency?.tone).toBe("warn");
    expect(consistency?.evidence).toMatchObject({ runsInWindow: 0, windowDays: 30 });
  });

  it("stays quiet in the middle, where neither reading is true", () => {
    // Six days in thirty. Not abandoned, not sticking — the interesting range is
    // exactly the one with nothing worth saying.
    const runs = [1, 5, 9, 14, 19, 25].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 }),
    );
    expect(ids(runs)).not.toContain("consistency");
  });
});

describe("timing", () => {
  it("needs more runs than the other rules", () => {
    // Five morning runs is not enough to claim mornings beat evenings.
    const runs = [1, 2, 3, 4, 5].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 }),
    );
    expect(ids(runs)).not.toContain("timing");
  });

  it("finds the hour with the better finish rate", () => {
    const runs = [
      // Mornings: all six finished.
      ...[1, 2, 3, 4, 5, 6].map((d) => run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 })),
      // Evenings: mostly abandoned.
      ...[1, 2, 3, 4].map((d) => run({ daysAgo: d, hour: 20, minutes: 10, completedItems: 1 })),
    ];
    const timing = suggestFromHistory(STEPS, runs, NOW).find((s) => s.id === "timing");

    expect(timing?.title).toContain("7am");
    expect(timing?.evidence).toMatchObject({ runs: 10 });
  });

  it("stays quiet when every hour performs the same", () => {
    const runs = [
      ...[1, 2, 3, 4, 5].map((d) => run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 })),
      ...[1, 2, 3, 4, 5].map((d) => run({ daysAgo: d, hour: 20, minutes: 50, completedItems: 4 })),
    ];
    expect(ids(runs)).not.toContain("timing");
  });

  it("ignores hours with a single run", () => {
    // One evening run that was abandoned is not an evening pattern, and treating
    // it as one would be the most confident and least supported claim on the card.
    const runs = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((d) =>
        run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 }),
      ),
      run({ daysAgo: 9, hour: 23, minutes: 10, completedItems: 0 }),
    ];
    expect(ids(runs)).not.toContain("timing");
  });
});

describe("ordering", () => {
  it("puts warnings first", () => {
    const runs = [
      ...[1, 2, 3].map((d) => run({ daysAgo: d, hour: 7, minutes: 20, completedItems: 1 })),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) =>
        run({ daysAgo: d, hour: 7, minutes: 50, completedItems: 4 }),
      ),
    ];
    const tones = suggestFromHistory(STEPS, runs, NOW).map((s) => s.tone);

    expect(tones.indexOf("praise")).toBe(-1);
    expect(tones.filter((t) => t === "warn").length).toBeGreaterThan(0);
  });

  it("returns a stable order for the same history", () => {
    const runs = [1, 2, 3, 4].map((d) =>
      run({ daysAgo: d, hour: 7, minutes: 100, completedItems: 2 }),
    );
    expect(ids(runs)).toEqual(ids(runs));
  });
});
