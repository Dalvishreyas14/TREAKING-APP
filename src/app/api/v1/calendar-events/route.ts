import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { calendarEventCreateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/calendar-events?from&to    POST /api/v1/calendar-events
 *
 * The range query is an *instant* overlap test (`startAt < to` AND `endAt > from`),
 * not `startAt between from and to`. An event that begins the week before the
 * window and runs into it — a three-day conference, a long flight — overlaps the
 * window and belongs in the response. Querying on `startAt` alone silently drops
 * exactly those, which is the whole reason a calendar view looks empty on a day
 * you are actually busy.
 *
 * `source` is not settable from this route: events created here are LOCAL, and
 * GOOGLE/OUTLOOK rows belong to a connection. Letting a client claim a provider
 * would let a local event masquerade as synced data.
 */

const listQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});

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

export const GET = withApi({
  method: "GET",
  query: listQuery,
  async handler({ user, query }) {
    if (query.to.getTime() <= query.from.getTime()) {
      return { items: [], range: { from: query.from, to: query.to } };
    }

    const [events, connections] = await Promise.all([
      prisma.calendarEvent.findMany({
        where: {
          userId: user.id,
          startAt: { lt: query.to },
          endAt: { gt: query.from },
        },
        orderBy: { startAt: "asc" },
        take: query.limit,
        select: eventSelect,
      }),
      prisma.calendarConnection.findMany({
        where: { userId: user.id },
        orderBy: { provider: "asc" },
        // Tokens are deliberately not selected. Nothing in this app needs them,
        // and leaving them out means no query in the codebase can leak one.
        select: { id: true, provider: true, email: true, expiresAt: true, createdAt: true },
      }),
    ]);

    return { items: events, connections, range: { from: query.from, to: query.to } };
  },
});

export const POST = withApi({
  method: "POST",
  body: calendarEventCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const event = await prisma.calendarEvent.create({
      data: {
        userId: user.id,
        title: body.title,
        description: body.description ?? null,
        startAt: body.startAt,
        endAt: body.endAt,
        allDay: body.allDay,
        location: body.location ?? null,
        color: body.color,
        source: "LOCAL",
      },
      select: eventSelect,
    });

    return event;
  },
});
