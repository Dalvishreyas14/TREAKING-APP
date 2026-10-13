import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { calendarEventUpdateSchema } from "@/lib/validation/schemas";

/**
 * PATCH /api/v1/calendar-events/:id    DELETE /api/v1/calendar-events/:id
 *
 * A PATCH is merged against the stored event before validation, because a request
 * that only moves `endAt` still has to be checked against the stored `startAt`.
 * Validating the partial body alone would accept an event that ends before the
 * time it already began.
 *
 * Events that arrived from a connected provider are read-only. Editing one would
 * be undone by the next sync, so the route refuses rather than accepting a write
 * that silently evaporates.
 */

const params = z.object({ id: z.string().min(1) });

const eventSelect = {
  id: true,
  title: true,
  description: true,
  startAt: true,
  endAt: true,
  allDay: true,
  location: true,
  color: true,
  source: true,
  externalId: true,
  rrule: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const PATCH = withApi({
  method: "PATCH",
  params,
  body: calendarEventUpdateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const existing = await prisma.calendarEvent.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, startAt: true, endAt: true, source: true },
    });
    assertOwnership(existing, user.id);

    if (existing!.source !== "LOCAL") {
      throw ApiError.conflict(
        "This event comes from a connected calendar. Edit it there instead.",
      );
    }

    const startAt = body.startAt ?? existing!.startAt;
    const endAt = body.endAt ?? existing!.endAt;

    if (endAt.getTime() <= startAt.getTime()) {
      throw ApiError.validation("An event has to end after it starts.", {
        endAt: "Pick an end time after the start time",
      });
    }

    const event = await prisma.calendarEvent.update({
      where: { id: existing!.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.allDay !== undefined ? { allDay: body.allDay } : {}),
        ...(body.location !== undefined ? { location: body.location } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        startAt,
        endAt,
      },
      select: eventSelect,
    });

    return event;
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const existing = await prisma.calendarEvent.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, source: true },
    });
    assertOwnership(existing, user.id);

    if (existing!.source !== "LOCAL") {
      throw ApiError.conflict("This event comes from a connected calendar. Remove it there.");
    }

    await prisma.calendarEvent.delete({ where: { id: existing!.id } });

    return { id: existing!.id, deleted: true };
  },
});
