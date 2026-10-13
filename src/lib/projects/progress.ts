/**
 * Project progress is derived, never stored.
 *
 * `Project` has no `progress` column, and adding one would mean every task
 * completion, re-assignment and deletion has to remember to update it — the kind
 * of invariant that silently rots the first time a code path forgets. Counting
 * the tasks is a single indexed aggregate and cannot drift.
 */

export interface ProjectTaskLinkLike {
  task: { status: string };
}

export interface ProjectProgress {
  done: number;
  total: number;
  percent: number;
}

/**
 * A project's progress is the share of its linked tasks that are DONE, 0-100.
 * A project with no tasks reports 0 rather than dividing by zero, and tasks that
 * are CANCELLED or ARCHIVED count toward the total so a cancelled task can't
 * quietly inflate the percentage by disappearing from the denominator.
 */
export function progressFromTasks(tasks: ProjectTaskLinkLike[]): ProjectProgress {
  const total = tasks.length;
  const done = tasks.filter((link) => link.task.status === "DONE").length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}
