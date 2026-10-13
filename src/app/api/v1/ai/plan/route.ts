import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { dateOnly } from "@/lib/date";
import { LIMITS } from "@/lib/rate-limit";
import { aiPlanSchema } from "@/lib/validation/schemas";
import { loadSnapshot } from "@/lib/ai/snapshot";
import { buildDayPlan } from "@/lib/ai/day-plan";

/**
 * POST /api/v1/ai/plan
 *
 * Proposes how to spend a day. Writes nothing.
 *
 * The output is a set of candidate blocks. Turning them into real ones is a
 * separate call to `POST /api/v1/time-blocks` with the slots the user kept. This
 * is the single most important boundary in the AI layer: a planner that inserts
 * blocks on its own turns a bad heuristic into a calendar the user did not agree
 * to and cannot easily undo.
 *
 * Re-planning is free and idempotent because nothing is stored, so a user can ask
 * again with a different budget as many times as they like. That is why this
 * endpoint is rate-limited far more loosely than chat.
 */

export const POST = withApi({
  method: "POST",
  body: aiPlanSchema,
  rateLimit: LIMITS.aiPlan,
  async handler({ user, body }) {
    const today = dateOnly(new Date());
    const target = body.date ? dateOnly(body.date) : today;

    // Refuse to plan into the past. A plan for a day that has already happened is
    // either a timezone artefact or a mistake, and returning slots for it would be
    // a silent no-op the user would have to diagnose.
    if (target.getTime() < today.getTime()) {
      throw ApiError.badRequest("Pick today or a day that has not passed yet.", {
        date: "That day has already happened",
      });
    }

    // One snapshot for the whole request. `loadSnapshot` already looks forward
    // through deadlines, so a task due on the target day is in the data whether
    // that day is today or next month; the target is passed separately to the
    // planner, which is the only thing that needs to know which day is being
    // filled.
    const snapshot = await loadSnapshot(user.id, { days: 30 });

    if (!snapshot.profile.aiEnabled) {
      throw ApiError.aiUnavailable("Turn the planner on in settings to use it.");
    }

    const plan = buildDayPlan(
      snapshot,
      target,
      body.availableMinutes != null ? { availableMinutes: body.availableMinutes } : {},
    );

    return {
      date: plan.date.toISOString(),
      availableMinutes: plan.availableMinutes,
      committedMinutes: plan.committedMinutes,
      proposedMinutes: plan.proposedMinutes,
      remainingMinutes: plan.remainingMinutes,
      slots: plan.slots,
      unplaced: plan.unplaced,
      rationale: plan.rationale,
      source: "LOCAL" as const,
    };
  },
});
