import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { LIMITS } from "@/lib/rate-limit";
import { pauseRoutine } from "@/lib/fitness/schedule";

/**
 * POST /api/v1/workout-routines/:id/pause
 *
 * Stop the routine driving the schedule. Sessions already materialised are left
 * in place — pausing the template does not cancel training the user has been
 * counting on.
 */

const params = z.object({ id: z.string().min(1) });

export const POST = withApi({
  method: "POST",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    return pauseRoutine(user.id, params.id);
  },
});
