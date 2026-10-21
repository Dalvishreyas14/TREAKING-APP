import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { LIMITS } from "@/lib/rate-limit";
import { applyRoutine } from "@/lib/fitness/schedule";
import { workoutRoutineApplySchema } from "@/lib/validation/schemas";

/**
 * POST /api/v1/workout-routines/:id/apply
 *
 * Push the (possibly edited) template onto the calendar. `future` refills from
 * today to the horizon; `week` refills only the named week. Sessions the user
 * has completed, skipped, rescheduled or started are never touched.
 */

const params = z.object({ id: z.string().min(1) });

export const POST = withApi({
  method: "POST",
  params,
  body: workoutRoutineApplySchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    return applyRoutine(user.id, params.id, body.scope, body.week);
  },
});
