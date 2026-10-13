import { describe, expect, it } from "vitest";

import {
  RESOURCE_STATUS_LABEL,
  isActive,
  isClosed,
  resourceSubtitle,
  resourceTransition,
  type ResourceState,
} from "@/lib/knowledge/resources";

/**
 * Resource status transitions.
 *
 * The `Resource` model stores status, progress, `startedAt` and `finishedAt` as
 * four independent columns, so the database will happily accept states that are
 * incoherent — a book marked FINISHED with no finish date and 0% read. These
 * tests are the reason that cannot happen, and most of them are about a state
 * that looks fine in isolation and lies in aggregate: a "finished" resource with
 * no date is invisible to any average computed over finish dates, and a dropped
 * book counted as 100% inflates the completion rate the study screen shows.
 *
 * Every case pins `now`, because a transition that quietly reads the clock is
 * exactly the kind of thing that passes in CI and fails in production.
 */

const NOW = new Date("2026-03-15T09:30:00.000Z");
const EARLIER = new Date("2026-02-01T09:00:00.000Z");

function state(overrides: Partial<ResourceState> = {}): ResourceState {
  return {
    status: "WANTING",
    progress: 0,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe("starting", () => {
  it("stamps startedAt the first time a resource leaves the shelf", () => {
    const next = resourceTransition(state(), { status: "IN_PROGRESS" }, NOW);

    expect(next.startedAt).toEqual(NOW);
    expect(next.status).toBe("IN_PROGRESS");
  });

  it("leaves a resource on the shelf undated", () => {
    // A WANTING list with dates on every entry claims the user began books they
    // have not opened, and makes "started this month" a list of intentions.
    const next = resourceTransition(state(), { status: "WANTING" }, NOW);

    expect(next.startedAt).toBeNull();
    expect(next.finishedAt).toBeNull();
  });

  it("keeps the original start date when re-saving an in-progress resource", () => {
    // Otherwise "how long have I been on this" resets every time the progress
    // bar is touched, which is the only reason to touch it.
    const next = resourceTransition(
      state({ status: "IN_PROGRESS", progress: 40, startedAt: EARLIER }),
      { progress: 45 },
      NOW,
    );

    expect(next.startedAt).toEqual(EARLIER);
  });

  it("stamps a start date when coming off a hold", () => {
    const next = resourceTransition(state({ status: "ON_HOLD" }), { status: "IN_PROGRESS" }, NOW);

    expect(next.startedAt).toEqual(NOW);
  });

  it("does not wipe the start date when pausing", () => {
    // Time spent before the pause is still time spent.
    const next = resourceTransition(
      state({ status: "IN_PROGRESS", startedAt: EARLIER }),
      { status: "ON_HOLD" },
      NOW,
    );

    expect(next.startedAt).toEqual(EARLIER);
  });
});

describe("finishing", () => {
  it("stamps finishedAt and fills the bar", () => {
    const next = resourceTransition(
      state({ status: "IN_PROGRESS", progress: 30, startedAt: EARLIER }),
      { status: "FINISHED" },
      NOW,
    );

    expect(next.finishedAt).toEqual(NOW);
    expect(next.progress).toBe(100);
    // The start date survives, which is what makes a reading duration possible.
    expect(next.startedAt).toEqual(EARLIER);
  });

  it("fills the bar for a resource finished before it was ever started", () => {
    // Logging a book already read. There is no honest start date to invent, so
    // there is none, and the bar still says 100%.
    const next = resourceTransition(state(), { status: "FINISHED" }, NOW);

    expect(next.startedAt).toBeNull();
    expect(next.finishedAt).toEqual(NOW);
    expect(next.progress).toBe(100);
  });

  it("keeps an explicit progress when finishing", () => {
    // "I read the whole thing but the progress slider is at 60" is a real state
    // when someone is logging retroactively, and the request should win.
    const next = resourceTransition(state({ progress: 10 }), { status: "FINISHED", progress: 60 }, NOW);

    expect(next.progress).toBe(60);
  });

  it("does not move the original finish date when re-saving", () => {
    const next = resourceTransition(
      state({ status: "FINISHED", progress: 100, finishedAt: EARLIER }),
      { status: "FINISHED" },
      NOW,
    );

    expect(next.finishedAt).toEqual(EARLIER);
  });

  it("does not finish a resource on progress alone", () => {
    // Finishing is a decision. Someone can read every page and still have the
    // review to write, and the app does not get to make that call.
    const next = resourceTransition(
      state({ status: "IN_PROGRESS", startedAt: EARLIER }),
      { progress: 100 },
      NOW,
    );

    expect(next.status).toBe("IN_PROGRESS");
    expect(next.finishedAt).toBeNull();
  });
});

describe("un-finishing", () => {
  it("clears the finish date when moving back to in-progress", () => {
    // "Finished at" is a claim about the present. A resource picked up again was
    // not finished, and leaving the date would keep it in finished-date averages.
    const next = resourceTransition(
      state({ status: "FINISHED", progress: 100, startedAt: EARLIER, finishedAt: EARLIER }),
      { status: "IN_PROGRESS" },
      NOW,
    );

    expect(next.finishedAt).toBeNull();
    expect(next.status).toBe("IN_PROGRESS");
  });

  it("pulls the bar off 100 when reopening", () => {
    // Left at 100 it would read as "done" on a card that says "reading now".
    const next = resourceTransition(
      state({ status: "FINISHED", progress: 100, finishedAt: EARLIER }),
      { status: "IN_PROGRESS" },
      NOW,
    );

    expect(next.progress).toBe(99);
  });

  it("keeps an explicit progress when reopening", () => {
    const next = resourceTransition(
      state({ status: "FINISHED", progress: 100, finishedAt: EARLIER }),
      { status: "IN_PROGRESS", progress: 80 },
      NOW,
    );

    expect(next.progress).toBe(80);
  });

  it("keeps the start date when reopening", () => {
    const next = resourceTransition(
      state({ status: "FINISHED", progress: 100, startedAt: EARLIER, finishedAt: EARLIER }),
      { status: "IN_PROGRESS" },
      NOW,
    );

    expect(next.startedAt).toEqual(EARLIER);
  });
});

describe("dropping", () => {
  it("keeps the progress it was dropped at", () => {
    // Forcing this to 100% would make "finished" mean both "read" and "gave up",
    // and would inflate the completion rate the study screen computes.
    const next = resourceTransition(
      state({ status: "IN_PROGRESS", progress: 30, startedAt: EARLIER }),
      { status: "DROPPED" },
      NOW,
    );

    expect(next.progress).toBe(30);
    expect(next.status).toBe("DROPPED");
  });

  it("does not record a finish date", () => {
    // A dropped resource must never enter an average of "when did you finish".
    const next = resourceTransition(
      state({ status: "IN_PROGRESS", progress: 30, startedAt: EARLIER }),
      { status: "DROPPED" },
      NOW,
    );

    expect(next.finishedAt).toBeNull();
  });

  it("clears a finish date when dropping something already finished", () => {
    const next = resourceTransition(
      state({ status: "FINISHED", progress: 100, startedAt: EARLIER, finishedAt: EARLIER }),
      { status: "DROPPED" },
      NOW,
    );

    expect(next.finishedAt).toBeNull();
    expect(next.progress).toBe(99);
  });
});

describe("no-op patches", () => {
  it("changes nothing when neither status nor progress is given", () => {
    const current = state({ status: "IN_PROGRESS", progress: 42, startedAt: EARLIER });
    const next = resourceTransition(current, {}, NOW);

    expect(next).toEqual(current);
  });

  it("does not stamp dates on a patch that only edits metadata", () => {
    // A title change routed through the transition must not make a WANTING book
    // look like it had been started.
    const next = resourceTransition(state(), {}, NOW);

    expect(next.startedAt).toBeNull();
    expect(next.finishedAt).toBeNull();
  });
});

describe("progress clamping", () => {
  it("rounds and clamps a progress value", () => {
    expect(resourceTransition(state(), { progress: 55.6 }, NOW).progress).toBe(56);
    expect(resourceTransition(state(), { progress: -10 }, NOW).progress).toBe(0);
    expect(resourceTransition(state(), { progress: 240 }, NOW).progress).toBe(100);
  });

  it("always returns an integer", () => {
    // A float would round-trip through the JSON API and render as "43.66667%" on
    // a progress bar.
    expect(Number.isInteger(resourceTransition(state(), { progress: 43.6667 }, NOW).progress)).toBe(
      true,
    );
  });
});

describe("predicates and labels", () => {
  it("treats only IN_PROGRESS as active", () => {
    expect(isActive("IN_PROGRESS")).toBe(true);
    expect(isActive("ON_HOLD")).toBe(false);
    expect(isActive("FINISHED")).toBe(false);
  });

  it("treats finished and dropped as closed", () => {
    expect(isClosed("FINISHED")).toBe(true);
    expect(isClosed("DROPPED")).toBe(true);
    expect(isClosed("IN_PROGRESS")).toBe(false);
    expect(isClosed("WANTING")).toBe(false);
    expect(isClosed("ON_HOLD")).toBe(false);
  });

  it("labels every status", () => {
    for (const status of ["WANTING", "IN_PROGRESS", "ON_HOLD", "FINISHED", "DROPPED"] as const) {
      expect(RESOURCE_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});

describe("resourceSubtitle", () => {
  it("prefers the finish date over the progress bar", () => {
    expect(resourceSubtitle({ status: "FINISHED", progress: 100 }, new Date("2026-03-01"))).toMatch(
      /Finished 1 Mar/,
    );
  });

  it("says just finished when there is no date", () => {
    // Should be rare, since the transition stamps one. Still better than
    // inventing a date in the view layer.
    expect(resourceSubtitle({ status: "FINISHED", progress: 100 }, null)).toBe("Finished");
  });

  it("reports the point of abandonment for a dropped resource", () => {
    expect(resourceSubtitle({ status: "DROPPED", progress: 30 }, null)).toBe("Dropped at 30%");
  });

  it("says not started rather than 0%", () => {
    expect(resourceSubtitle({ status: "WANTING", progress: 0 }, null)).toBe("Not started");
  });

  it("says paused rather than in progress for a held resource", () => {
    expect(resourceSubtitle({ status: "ON_HOLD", progress: 45 }, null)).toBe("Paused at 45%");
  });

  it("distinguishes just started from part way through", () => {
    expect(resourceSubtitle({ status: "IN_PROGRESS", progress: 0 }, null)).toBe("Just started");
    expect(resourceSubtitle({ status: "IN_PROGRESS", progress: 45 }, null)).toBe("45% through");
  });
});
