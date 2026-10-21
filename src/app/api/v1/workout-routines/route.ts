import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import {
  routineDaysCreateData,
  routineDetailSelect,
  serialiseRoutine,
} from "@/lib/fitness/schedule";
import { workoutRoutineCreateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/workout-routines   POST /api/v1/workout-routines
 *
 * Saved weekly training routines — the templates behind the weekly planner.
 * Creating one does not touch the schedule; a routine only materialises sessions
 * once it is activated or applied. That separation is deliberate: building a
 * "5-day split" is planning, and pushing it onto the calendar is a separate,
 * explicit commitment.
 */

export const GET = withApi({
  method: "GET",
  async handler({ user }) {
    const routines = await prisma.workoutRoutine.findMany({
      where: { userId: user.id },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: routineDetailSelect,
    });
    return { items: routines.map(serialiseRoutine) };
  },
});

export const POST = withApi({
  method: "POST",
  body: workoutRoutineCreateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const created = await prisma.workoutRoutine.create({
      data: {
        userId: user.id,
        name: body.name,
        description: body.description ?? null,
        ...(body.color ? { color: body.color } : {}),
        days: { create: routineDaysCreateData(body.days) },
      },
      select: routineDetailSelect,
    });
    return serialiseRoutine(created);
  },
});
