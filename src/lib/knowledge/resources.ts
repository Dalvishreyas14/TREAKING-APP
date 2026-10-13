import type { ResourceStatus } from "@/generated/prisma/enums";

/**
 * What moving a resource between shelves does to its dates and progress.
 *
 * A `Resource` carries `status`, `progress`, `startedAt` and `finishedAt` as four
 * independent columns, which is the flattest possible design and also the one
 * that makes the most incoherent states reachable. The database will happily
 * accept a book that is `FINISHED`, has `finishedAt: null`, and claims 0% read.
 * This module is the only place those four are written together, so the
 * combinations that cannot happen cannot happen.
 *
 * The one direction that is deliberately *not* automatic is progress reaching
 * 100%. Finishing is a decision, not a consequence of arithmetic: someone can
 * read every page of a book and still have the review to write, and the moment
 * the app decided they were done it would be making that call for them. The
 * other direction is automatic, because calling something finished while it says
 * 0% is a contradiction rather than a judgement.
 */

export interface ResourceState {
  status: ResourceStatus;
  progress: number;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ResourcePatch {
  status?: ResourceStatus;
  progress?: number;
}

/** Statuses that mean the user is not working on it at the moment. */
const NOT_FINISHED: ReadonlySet<ResourceStatus> = new Set<ResourceStatus>([
  "FINISHED",
  "DROPPED",
]);

/**
 * The fields a status change implies, for a transition from `from` to `to`.
 *
 * Returns only the columns that need writing, so a caller can spread it into a
 * Prisma update alongside the user's own edits without clobbering them.
 */
export function resourceTransition(
  current: ResourceState,
  patch: ResourcePatch,
  now: Date = new Date(),
): { status: ResourceStatus; progress: number; startedAt: Date | null; finishedAt: Date | null } {
  const status = patch.status ?? current.status;
  let progress = patch.progress ?? current.progress;
  let startedAt = current.startedAt;
  let finishedAt = current.finishedAt;

  /*
   * Starting. `startedAt` is stamped the first time something leaves the shelf,
   * and only then — a `WANTING` list with dates on every entry would claim the
   * user had begun books they have not opened, and the "started this month"
   * number would be a list of intentions.
   *
   * This also covers coming off ON_HOLD, and re-starting something already in
   * progress leaves the original date alone, so "how long have I been on this"
   * stays true across a pause.
   */
  if (status === "IN_PROGRESS" && !startedAt) {
    startedAt = now;
  }

  /*
   * Finishing. `finishedAt` is stamped, and progress is forced to 100 unless the
   * user said otherwise in this same request. A resource marked FINISHED that
   * reports 40% is the exact incoherence this function exists to prevent.
   */
  if (status === "FINISHED") {
    finishedAt = current.finishedAt ?? now;
    if (patch.progress === undefined) progress = 100;
  }

  /*
   * Un-finishing. Moving off FINISHED — back to IN_PROGRESS, ON_HOLD or DROPPED —
   * clears the completion date, because "finished at" is a claim about the
   * present tense, not a historical fact. Nothing is lost: a resource that was
   * once finished and is being picked up again was not really finished.
   */
  if (current.status === "FINISHED" && status !== "FINISHED") {
    finishedAt = null;
    // Only reset the progress bar if the user is not supplying a new figure.
    if (patch.progress === undefined) progress = Math.min(current.progress, 99);
  }

  /*
   * Dropping is not finishing. A dropped book is abandoned, often at 30%, and
   * forcing it to 100% would make "finished" mean two different things and make
   * the completion counts wrong. `finishedAt` stays null so a dropped resource
   * never enters a "when did you finish things" average.
   */
  if (status === "DROPPED") {
    finishedAt = null;
  }

  // Clamped rather than rejected: a PATCH that sets progress and a new status at
  // once should not fail because the two arrived in an unhelpful order.
  progress = Math.max(0, Math.min(100, Math.round(progress)));

  return { status, progress, startedAt, finishedAt };
}

/** True for a resource the user is actively working through. */
export function isActive(status: ResourceStatus): boolean {
  return status === "IN_PROGRESS";
}

/** True for a resource that reached a conclusion, either way. */
export function isClosed(status: ResourceStatus): boolean {
  return NOT_FINISHED.has(status);
}

export const RESOURCE_STATUS_LABEL: Record<ResourceStatus, string> = {
  WANTING: "Wanting to read",
  IN_PROGRESS: "Reading now",
  ON_HOLD: "On hold",
  FINISHED: "Finished",
  DROPPED: "Dropped",
};

export const RESOURCE_KIND_LABEL: Record<string, string> = {
  BOOK: "Book",
  COURSE: "Course",
  ARTICLE: "Article",
  VIDEO: "Video",
  PODCAST: "Podcast",
  PAPER: "Paper",
  TOOL: "Tool",
  OTHER: "Other",
};

/**
 * A one-line "where is this now", for a card.
 *
 * Prefers the thing that is true and checkable over the thing that is merely
 * true: a finished date is a fact, a progress bar is an estimate, and a resource
 * with neither gets its shelf instead of a number nobody set.
 */
export function resourceSubtitle(
  resource: Pick<ResourceState, "status" | "progress">,
  finishedAt: Date | null,
): string {
  if (resource.status === "FINISHED") {
    return finishedAt
      ? `Finished ${finishedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
      : "Finished";
  }
  if (resource.status === "DROPPED") return `Dropped at ${resource.progress}%`;
  if (resource.status === "WANTING") return "Not started";
  if (resource.status === "ON_HOLD") return `Paused at ${resource.progress}%`;
  return resource.progress > 0 ? `${resource.progress}% through` : "Just started";
}
