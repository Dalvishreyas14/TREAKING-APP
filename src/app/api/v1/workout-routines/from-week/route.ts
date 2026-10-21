import { withApi } from "@/lib/api/with-api";
import { LIMITS } from "@/lib/rate-limit";
import { routineFromWeek } from "@/lib/fitness/schedule";
import { workoutRoutineFromWeekSchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/workout-routines/from-week
 *
 * Save a week's existing schedule as a reusable routine. This is the "I built a
 * week I like, make it repeatable" path.
 */

export const POST = withApi({
  method: "POST",
  body: workoutRoutineFromWeekSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    return routineFromWeek(user.id, body.week, body.name, body.description ?? null);
  },
});
