import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { LIMITS } from "@/lib/rate-limit";
import { activateRoutine } from "@/lib/fitness/schedule";

/**
 * POST /api/v1/workout-routines/:id/activate
 *
 * Make this the routine driving the schedule. Any other active routine is paused
 * (at most one drives today), and the schedule is filled to the rolling horizon.
 */

const params = z.object({ id: z.string().min(1) });

export const POST = withApi({
  method: "POST",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    return activateRoutine(user.id, params.id);
  },
});
