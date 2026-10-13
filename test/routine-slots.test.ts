import { describe, expect, it } from "vitest";

import {
  planRoutineSlots,
  summariseSlots,
  tasksForTickedSteps,
  type RoutineStepSlot,
} from "@/lib/routines/slots";

/**
 * The routine-to-task slot planner.
 *
 * The decision table is small, and each row of it is a way the feature could go
 * wrong in a way the user only notices weeks later — a task that never reopens, a
 * pile of duplicates, or a task deleted because a checkbox moved. So each case here
 * is a scenario rather than an assertion about shape.
 */

function step(overrides: Partial<RoutineStepSlot> & { id: string }): RoutineStepSlot {
  return {
    title: `Step ${overrides.id}`,
    estimatedMinutes: 10,
    categoryId: null,
    createsTask: true,
    task: null,
    ...overrides,
  };
}

describe("planRoutineSlots", () => {
  it("creates a task for a step that has never been run", () => {
    const [action] = planRoutineSlots([step({ id: "a" })]);

    expect(action).toEqual({
      op: "create",
      stepId: "a",
      title: "Step a",
      estimatedMinutes: 10,
      categoryId: null,
    });
  });

  it("reopens a done task rather than creating a second one", () => {
    // The case the whole reuse model exists for. Creating a new task here would
    // give the user a fresh row every morning and leave the completion history
    // behind on the old one.
    const [action] = planRoutineSlots([
      step({ id: "a", task: { id: "task-1", status: "DONE" } }),
    ]);

    expect(action).toEqual({ op: "reopen", stepId: "a", taskId: "task-1" });
  });

  it("leaves an open task alone so an in-progress task is not reset", () => {
    // Reopening an IN_PROGRESS task on a new run would silently undo the user's
    // own progress every time they started the routine again.
    for (const status of ["TODO", "IN_PROGRESS", "BLOCKED"] as const) {
      const [action] = planRoutineSlots([
        step({ id: "a", task: { id: "task-1", status } }),
      ]);

      expect(action).toEqual({ op: "keep", stepId: "a", taskId: "task-1" });
    }
  });

  it("retires a cancelled or archived task and makes a new one", () => {
    // A task the user deliberately closed is not a slot waiting to be reused.
    // Writing a fresh task over `taskId` is the only way to keep the step working,
    // and the old row is left intact for its history.
    for (const status of ["CANCELLED", "ARCHIVED"] as const) {
      const [action] = planRoutineSlots([
        step({ id: "a", task: { id: "task-1", status } }),
      ]);

      expect(action).toEqual({ op: "retire", stepId: "a", taskId: "task-1" });
    }
  });

  it("skips a step that does not produce tasks", () => {
    const [action] = planRoutineSlots([step({ id: "a", createsTask: false })]);

    expect(action).toEqual({ op: "skip", stepId: "a" });
  });

  it("keeps the existing task when a step is turned off", () => {
    // Not a delete. The task is real, may have been edited, and a toggle in a
    // routine editor is not consent to discard it.
    const [action] = planRoutineSlots([
      step({ id: "a", createsTask: false, task: { id: "task-1", status: "TODO" } }),
    ]);

    expect(action).toEqual({ op: "keep", stepId: "a", taskId: "task-1" });
  });

  it("plans each step independently", () => {
    const actions = planRoutineSlots([
      step({ id: "a", task: { id: "task-1", status: "DONE" } }),
      step({ id: "b", task: { id: "task-2", status: "TODO" } }),
      step({ id: "c" }),
      step({ id: "d", createsTask: false }),
    ]);

    expect(actions.map((a) => a.op)).toEqual(["reopen", "keep", "create", "skip"]);
  });
});

describe("summariseSlots", () => {
  it("counts each operation", () => {
    const summary = summariseSlots(
      planRoutineSlots([
        step({ id: "a", task: { id: "task-1", status: "DONE" } }),
        step({ id: "b", task: { id: "task-2", status: "TODO" } }),
        step({ id: "c" }),
        step({ id: "d", task: { id: "task-3", status: "CANCELLED" } }),
        step({ id: "e", createsTask: false }),
      ]),
    );

    expect(summary).toMatchObject({ created: 1, reopened: 1, kept: 1, retired: 1, skipped: 1 });
  });

  it("does not count a retired slot as completable", () => {
    // Its replacement task was created seconds ago and has never been done, so
    // there is nothing for a later run-close to finish.
    const summary = summariseSlots([
      { op: "retire", stepId: "a", taskId: "task-1" },
      { op: "create", stepId: "b", title: "B", estimatedMinutes: null, categoryId: null },
    ]);

    expect(summary.taskIds).toEqual([]);
  });
});

describe("tasksForTickedSteps", () => {
  it("returns the tasks behind the ticked steps", () => {
    const steps = [
      { id: "a", taskId: "task-1" },
      { id: "b", taskId: "task-2" },
      { id: "c", taskId: "task-3" },
    ];

    expect(tasksForTickedSteps(steps, ["a", "c"]).sort()).toEqual(["task-1", "task-3"]);
  });

  it("ignores ticks on steps with no task", () => {
    // A step created before it produced tasks, or one with production turned off.
    // Neither has anything to complete, and a null must not reach the query.
    const steps = [
      { id: "a", taskId: null },
      { id: "b", taskId: "task-2" },
    ];

    expect(tasksForTickedSteps(steps, ["a"])).toEqual([]);
  });

  it("ignores ticked ids that are not steps of this routine", () => {
    // The ids come from the client, so an unknown or foreign id is expected input
    // rather than an error condition. Returning nothing is the safe read.
    const steps = [{ id: "a", taskId: "task-1" }];

    expect(tasksForTickedSteps(steps, ["a", "not-a-step"])).toEqual(["task-1"]);
  });

  it("deduplicates a step bound to the same task twice", () => {
    const steps = [
      { id: "a", taskId: "task-1" },
      { id: "b", taskId: "task-1" },
    ];

    expect(tasksForTickedSteps(steps, ["a", "b"])).toEqual(["task-1"]);
  });

  it("returns nothing when no steps were ticked", () => {
    expect(tasksForTickedSteps([{ id: "a", taskId: "task-1" }], [])).toEqual([]);
  });
});
