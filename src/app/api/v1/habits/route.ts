import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { todayUtc } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import { habitCreateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/habits
 *
 * Returns each habit with its log for the requested day already joined in, so a
 * client rendering a checklist makes one request rather than one per habit. The
 * day is a UTC date because `HabitLog.date` is a `@db.Date` column — see
 * `src/lib/date.ts` for why that distinction is load-bearing.
 *
 * `days` is the trailing window used for the per-habit heat strip.
 */
export const GET = withApi({
  method: "GET",
  query: z.object({
    includeArchived: z.coerce.boolean().default(false),
    days: z.coerce.number().int().min(7).max(365).default(28),
  }),
  async handler({ user, query }) {
    const today = todayUtc();
    const from = new Date(today.getTime() - (query.days - 1) * 86_400_000);

    const [habits, logs] = await Promise.all([
      prisma.habit.findMany({
        where: {
          userId: user.id,
          ...(query.includeArchived ? {} : { isActive: true, archivedAt: null }),
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          icon: true,
          color: true,
          type: true,
          frequency: true,
          unit: true,
          targetValue: true,
          targetMinutes: true,
          timesPerPeriod: true,
          preferredMinutes: true,
          isActive: true,
          archivedAt: true,
          category: { select: { id: true, name: true, color: true } },
          schedule: { select: { dayOfWeek: true } },
        },
      }),
      prisma.habitLog.findMany({
        where: { userId: user.id, date: { gte: from, lte: today } },
        select: { habitId: true, date: true, value: true, completed: true },
      }),
    ]);

    const byHabit = new Map<string, typeof logs>();
    for (const log of logs) {
      const list = byHabit.get(log.habitId);
      if (list) list.push(log);
      else byHabit.set(log.habitId, [log]);
    }

    return {
      date: today.toISOString(),
      items: habits.map((habit) => {
        const history = byHabit.get(habit.id) ?? [];
        const todayLog = history.find((l) => l.date.getTime() === today.getTime());
        return {
          ...habit,
          today: {
            value: todayLog?.value ?? 0,
            completed: todayLog?.completed ?? false,
          },
          // Ascending by date so the strip can be indexed by offset from today.
          history: history
            .map((l) => ({
              date: l.date.toISOString(),
              value: l.value,
              completed: l.completed,
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        };
      }),
    };
  },
});

/**
 * POST /api/v1/habits
 *
 * A CUSTOM-frequency habit carries its own `HabitSchedule` rows, created in the
 * same transaction as the habit so a half-configured habit can never exist.
 */
export const POST = withApi({
  method: "POST",
  body: habitCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const habit = await prisma.$transaction(async (tx) => {
      const created = await tx.habit.create({
        data: {
          userId: user.id,
          name: body.name,
          description: body.description ?? null,
          icon: body.icon,
          color: body.color,
          type: body.type,
          difficulty: body.difficulty,
          frequency: body.frequency,
          unit: body.unit ?? null,
          targetValue: body.targetValue,
          targetMinutes: body.targetMinutes ?? null,
          timesPerPeriod: body.timesPerPeriod ?? null,
          preferredMinutes: body.preferredMinutes ?? null,
          startDate: todayUtc(),
        },
        select: { id: true, name: true, color: true, type: true, targetValue: true },
      });

      if (body.frequency === "CUSTOM" && body.daysOfWeek?.length) {
        await tx.habitSchedule.createMany({
          data: body.daysOfWeek.map((dayOfWeek) => ({
            habitId: created.id,
            dayOfWeek,
          })),
          // The unique index on (habitId, dayOfWeek) is the real guard; this
          // just makes a repeated day in the payload a no-op rather than an error.
          skipDuplicates: true,
        });
      }

      return created;
    });

    return habit;
  },
});
