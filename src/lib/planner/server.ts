/**
 * Time block plumbing shared by the planner's API routes.
 *
 * The planner's central hazard is that a block is stored as a *day* and a *pair
 * of real instants*, and those two disagree for part of every day. `date` is a
 * `@db.Date` — UTC midnight — while `startAt` is when the block genuinely
 * starts. For a 2am block in IST those are a day apart, and deriving the day from
 * the instant files the block under yesterday, where it is invisible on the page
 * the user is looking at.
 *
 * So the translation lives here, once, instead of in each route handler.
 */

import { ApiError } from "@/lib/api/errors";
import { dateOnlyLocal } from "@/lib/date";
import { findConflict, formatClock } from "@/lib/planner/layout";
import { prisma } from "@/lib/db";
// Prisma 7 generates enums as const objects plus a derived union type, and
// re-exports both from the client entrypoint. `@prisma/client` is not the
// generated path in this project and exports neither.
import type { BlockSource } from "@/generated/prisma/client";

/** `2026-09-27` -> `Date` at UTC midnight, the form a `@db.Date` column holds. */
export function isoDayToDateOnly(isoDay: string): Date {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** `Date` at UTC midnight -> `2026-09-27`. */
export function dateOnlyToIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Build the real instants for a block from a local day, a start time and a
 * duration.
 *
 * `new Date(y, m, d, h, min)` is the whole trick: those are local components, so
 * it produces the instant the user meant, and `dateOnlyLocal` maps that instant
 * back to the day they were looking at. The two call sites of this helper
 * (`localDate` and the start) are deliberately the same calendar day, which is
 * what makes the `date` column and the rendered time agree.
 */
export function blockInstants(
  isoDay: string,
  startMinutes: number,
  durationMinutes: number,
): { date: Date; startAt: Date; endAt: Date } {
  const [y, m, d] = isoDay.split("-").map(Number) as [number, number, number];
  const startAt = new Date(y, m - 1, d, Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);

  return { date: dateOnlyLocal(startAt), startAt, endAt };
}

/** Minutes from local midnight, for layout and conflict maths. */
export function blockMinutes(startAt: Date, endAt: Date): {
  startMinutes: number;
  endMinutes: number;
} {
  const startMinutes = startAt.getHours() * 60 + startAt.getMinutes();
  // A block that runs past local midnight would read as negative and collapse
  // the layout, so it is pinned to 1440 (end of day) instead.
  const raw = endAt.getHours() * 60 + endAt.getMinutes();
  const endMinutes = raw === 0 && endAt.getTime() > startAt.getTime() ? 1440 : raw;
  return { startMinutes, endMinutes };
}

export interface BlockWithRelations {
  id: string;
  title: string;
  date: Date;
  startAt: Date;
  endAt: Date;
  source: BlockSource;
  color: string;
  notes: string | null;
  locked: boolean;
  taskId: string | null;
  habitId: string | null;
  task?: { id: string; title: string; status: string } | null;
  habit?: { id: string; name: string; color: string } | null;
}

/** Serialise a block for the client, with its minutes derived server-side once. */
export function serialiseBlock(block: BlockWithRelations) {
  return {
    id: block.id,
    title: block.title,
    date: dateOnlyToIsoDay(block.date),
    startAt: block.startAt.toISOString(),
    endAt: block.endAt.toISOString(),
    ...blockMinutes(block.startAt, block.endAt),
    source: block.source,
    color: block.color,
    notes: block.notes,
    locked: block.locked,
    taskId: block.taskId,
    habitId: block.habitId,
    task: block.task ? { id: block.task.id, title: block.task.title, status: block.task.status } : null,
    habit: block.habit
      ? { id: block.habit.id, name: block.habit.name, color: block.habit.color }
      : null,
  };
}

/**
 * Reject a block that would double-book the user.
 *
 * Blocking outright is the strict choice; the alternative is to save it and draw
 * it half-width next to the conflict. Strict is right here because the planner's
 * value is that it tells the truth about a day, and a day that reports two
 * things happening at once is a day the user has to re-check by hand. The
 * message names the other block so the fix is obvious rather than a puzzle.
 *
 * `ignoreId` is the block being edited, so moving a block one minute later does
 * not collide with its own previous position.
 */
export async function assertNoConflict(
  userId: string,
  isoDay: string,
  startMinutes: number,
  durationMinutes: number,
  ignoreId?: string,
): Promise<void> {
  const day = isoDayToDateOnly(isoDay);
  const sameDay = await prisma.timeBlock.findMany({
    where: { userId, date: day },
    select: { id: true, title: true, startAt: true, endAt: true },
  });

  const candidate = {
    startMinutes,
    endMinutes: Math.min(startMinutes + durationMinutes, 1440),
  };

  const others = sameDay.map((b) => ({ id: b.id, ...blockMinutes(b.startAt, b.endAt) }));
  const conflict = findConflict(candidate, others, ignoreId);
  if (!conflict) return;

  const other = sameDay.find((b) => b.id === conflict.id)!;
  const from = formatClock(conflict.startMinutes);
  const to = formatClock(conflict.endMinutes);
  throw ApiError.conflict(
    `That overlaps "${other.title}" (${from} – ${to}). Move one of them first.`,
  );
}

/**
 * Verify a linked task or habit belongs to this user before storing it on a
 * block. Without this, a crafted `taskId` would attach someone else's task to
 * your plan — the block would render their task title on your dashboard.
 */
export async function assertLinkOwnership(
  userId: string,
  taskId?: string | null,
  habitId?: string | null,
): Promise<void> {
  if (taskId) {
    const task = await prisma.task.findFirst({ where: { id: taskId, userId }, select: { id: true } });
    if (!task) throw ApiError.badRequest("That task no longer exists.");
  }
  if (habitId) {
    const habit = await prisma.habit.findFirst({ where: { id: habitId, userId }, select: { id: true } });
    if (!habit) throw ApiError.badRequest("That habit no longer exists.");
  }
}
