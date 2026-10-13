import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { addDaysUtc, dateOnly, todayUtc } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import { moodEnergySchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/wellbeing?days=30
 * POST /api/v1/wellbeing
 *
 * A daily check-in. `@@unique([userId, date])` means one entry per day, so a
 * second submission updates the first rather than stacking — someone who
 * reconsiders their morning rating at 9pm should be able to change their mind,
 * and history should show the final answer rather than both.
 *
 * This is also the app's most sensitive data. It is never sent anywhere, and it
 * is excluded from every "engagement" style aggregate by design: the whole
 * point of tracking it is that it is only read by the person who wrote it.
 */

const query = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});

export const GET = withApi({
  method: "GET",
  query,
  async handler({ user, query: q }) {
    const today = todayUtc();
    const from = addDaysUtc(today, -(q.days - 1));

    const entries = await prisma.moodEnergyEntry.findMany({
      where: { userId: user.id, date: { gte: from, lte: today } },
      orderBy: { date: "asc" },
      select: {
        id: true,
        date: true,
        mood: true,
        energy: true,
        stress: true,
        sleepQuality: true,
        sleepHours: true,
        note: true,
      },
    });

    return {
      date: today.toISOString(),
      items: entries.map((e) => ({ ...e, date: e.date.toISOString() })),
    };
  },
});

export const POST = withApi({
  method: "POST",
  body: moodEnergySchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const date = dateOnly(body.date);
    if (date.getTime() > todayUtc().getTime()) {
      throw ApiError.validation("Some fields need attention.", {
        date: "You cannot check in for a future day.",
      });
    }

    const entry = await prisma.moodEnergyEntry.upsert({
      where: { userId_date: { userId: user.id, date } },
      create: {
        userId: user.id,
        date,
        mood: body.mood,
        energy: body.energy,
        stress: body.stress,
        sleepQuality: body.sleepQuality,
        sleepHours: body.sleepHours ?? null,
        note: body.note ?? null,
      },
      update: {
        mood: body.mood,
        energy: body.energy,
        stress: body.stress,
        sleepQuality: body.sleepQuality,
        sleepHours: body.sleepHours ?? null,
        note: body.note ?? null,
      },
      select: {
        id: true,
        date: true,
        mood: true,
        energy: true,
        stress: true,
        sleepQuality: true,
        sleepHours: true,
        note: true,
      },
    });

    return { ...entry, date: entry.date.toISOString() };
  },
});
