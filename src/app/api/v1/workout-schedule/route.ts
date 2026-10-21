import { withApi } from "@/lib/api/with-api";
import { getSchedule } from "@/lib/fitness/schedule";
import { workoutScheduleQuerySchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/workout-schedule?week=YYYY-MM-DD
 *
 * A single week of the workout calendar: the concrete sessions for each day,
 * which days the active routine marks as rest, and the active routine itself.
 * Reading it tops the schedule up to the rolling horizon first, so a week nobody
 * has visited yet is still populated.
 */

export const GET = withApi({
  method: "GET",
  query: workoutScheduleQuerySchema,
  async handler({ user, query }) {
    return getSchedule(user.id, query.week);
  },
});
