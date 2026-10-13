import type { TaskStatus } from "@/generated/prisma/enums";

/**
 * Turning a routine's steps into tasks.
 *
 * A routine step and a task are not the same thing, and the confusion is worth
 * naming: a step is a line in a template, and it is reused every run. A task is
 * a thing to do once. So a step cannot simply *be* a task, and creating a fresh
 * task on every run would bury the user's list in a daily pile-up of copies of
 * the same morning.
 *
 * The resolution is a stable slot. `RoutineItem.taskId` names one task that the
 * step reuses, so a routine owns at most `steps.length` tasks, forever:
 *
 *   no task yet      -> create one, and write its id back onto the step
 *   task is DONE     -> reopen it, because completing it completed the slot
 *   task is open     -> leave it exactly as it is
 *   task is CANCELLED
 *   or ARCHIVED      -> the slot was retired deliberately, so make a new one
 *
 * Reopening a DONE task is the part that reads like a bug and is not. The
 * alternative — creating a new task every run — is worse in a way that is
 * invisible for two weeks and then obvious: 60 near-identical tasks, and no
 * completion history attached to any of them. Reusing the row is what lets "did
 * I do my morning?" be one task that is sometimes done.
 *
 * Pure, so the decision table is testable without a database.
 */

export interface RoutineStepSlot {
  id: string;
  title: string;
  estimatedMinutes: number | null;
  categoryId: string | null;
  /** Whether this step should produce a task at all. */
  createsTask: boolean;
  /** The task this step is currently bound to, if it has ever been run. */
  task: { id: string; status: TaskStatus } | null;
}

export type SlotAction =
  | {
      op: "create";
      stepId: string;
      title: string;
      estimatedMinutes: number | null;
      categoryId: string | null;
    }
  | { op: "reopen"; stepId: string; taskId: string }
  | { op: "retire"; stepId: string; taskId: string }
  | { op: "keep"; stepId: string; taskId: string }
  | { op: "skip"; stepId: string };

/** Statuses that mean the slot was deliberately given up, not merely left undone. */
const RETIRED: ReadonlySet<TaskStatus> = new Set<TaskStatus>(["CANCELLED", "ARCHIVED"]);

export function planRoutineSlots(steps: RoutineStepSlot[]): SlotAction[] {
  return steps.map((step) => {
    if (!step.createsTask) {
      // A step turned off mid-life keeps whatever task it already made. Deleting
      // it would throw away a real task the user may have edited, renumbered or
      // written notes on, on the strength of a toggle in a routine editor.
      return step.task ? { op: "keep", stepId: step.id, taskId: step.task.id } : { op: "skip", stepId: step.id };
    }

    if (!step.task) {
      return {
        op: "create",
        stepId: step.id,
        title: step.title,
        estimatedMinutes: step.estimatedMinutes,
        categoryId: step.categoryId,
      };
    }

    if (RETIRED.has(step.task.status)) {
      return { op: "retire", stepId: step.id, taskId: step.task.id };
    }

    if (step.task.status === "DONE") {
      return { op: "reopen", stepId: step.id, taskId: step.task.id };
    }

    return { op: "keep", stepId: step.id, taskId: step.task.id };
  });
}

export interface SlotSummary {
  created: number;
  reopened: number;
  retired: number;
  kept: number;
  skipped: number;
  /** Ids of the tasks bound to steps that were ticked, for completion. */
  taskIds: string[];
}

export function summariseSlots(actions: SlotAction[]): SlotSummary {
  const out: SlotSummary = {
    created: 0,
    reopened: 0,
    retired: 0,
    kept: 0,
    skipped: 0,
    taskIds: [],
  };
  for (const action of actions) {
    switch (action.op) {
      case "create":
        out.created += 1;
        break;
      case "reopen":
        out.reopened += 1;
        out.taskIds.push(action.taskId);
        break;
      case "retire":
        // The old task is left alone; a new one is created and re-pointed. Nothing
        // to complete, because the new task has never been done.
        out.retired += 1;
        break;
      case "keep":
        out.kept += 1;
        out.taskIds.push(action.taskId);
        break;
      case "skip":
        out.skipped += 1;
        break;
    }
  }
  return out;
}

/**
 * The tasks behind the steps a run actually ticked.
 *
 * Resolved at close time rather than from the start-of-run plan, because a task
 * created when the run began has an id the plan could not have known. That is the
 * whole reason this is a second function: the start-of-run view and the
 * close-the-run view are of the same slots at two different times, and the second
 * one is the only place the binding is final.
 */
export function tasksForTickedSteps(
  steps: { id: string; taskId: string | null }[],
  tickedStepIds: string[],
): string[] {
  const ticked = new Set(tickedStepIds);
  const ids = new Set<string>();
  for (const step of steps) {
    if (ticked.has(step.id) && step.taskId) ids.add(step.taskId);
  }
  return [...ids];
}
