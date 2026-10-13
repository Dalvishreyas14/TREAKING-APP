import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { assertOwnership } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { weeklyPlanApplyTemplateSchema } from "@/lib/validation/schemas";
import {
  assertPlanParentOwnership,
  loadNewPlan,
  planDayOnly,
} from "@/lib/weekly-plans/server";

/**
 * POST /api/v1/weekly-plans/templates/:id    DELETE /api/v1/weekly-plans/templates/:id
 *
 * POST here is "apply this template", not "update this template". It sits beside
 * DELETE rather than under an `/apply` segment because both operate on the template
 * id itself, and a sibling segment would make `templates/apply` readable as a
 * template whose id is the literal string "apply".
 *
 * Applying a template creates a plan and a fresh set of tasks from the titles it
 * stored. It deliberately does not reattach the template's old tasks — see the
 * header in `templates/route.ts` for why a template holds titles rather than ids,
 * and `weekly-plans/[id]/copy` for the identical rule applied to a repeated week.
 *
 * The target window is sent explicitly rather than inferred, so "apply this to next
 * week" and "apply this to a fortnight starting the 14th" are the same call and
 * neither has to guess.
 *
 * DELETE removes the template only. Templates have no dependents — no plan holds a
 * reference to one, because a plan records what it was created from by value — so
 * removing one can never strand a plan pointing at nothing.
 */

const params = z.object({ id: z.string().min(1) });

/** The stored shape, re-parsed because a `Json` column can predate a schema. */
const templateConfigurationSchema = z.object({
  targetType: z.enum(["HOURS", "SESSIONS", "TASKS", "COUNT"]),
  targetValue: z.number().min(0),
  days: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        note: z.string().nullable().optional(),
        tasks: z.array(z.string().min(1).max(200)).max(30),
      }),
    )
    .max(7),
});

export const POST = withApi({
  method: "POST",
  params,
  body: weeklyPlanApplyTemplateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, params, body }) {
    const template = await prisma.weeklyPlanTemplate.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, name: true, category: true, configuration: true },
    });
    assertOwnership(template, user.id, "That template no longer exists.");

    // Refused rather than applied partially. A template whose stored shape no longer
    // parses would otherwise produce an empty plan wearing the right name, which is
    // indistinguishable from a bug that ate the user's work.
    const parsed = templateConfigurationSchema.safeParse(template!.configuration);
    if (!parsed.success) {
      throw ApiError.validation("That template cannot be read any more.", {
        template: "Recreate it from the plan you want to reuse",
      });
    }

    await assertPlanParentOwnership(user.id, body.goalId, body.projectId);

    /*
     * Grouped by day rather than flattened.
     *
     * `days.flatMap(day => day.tasks)` throws away which day each title belonged to
     * before any task is created — so applying a template produced a plan with the
     * right titles and no weekday assignments at all, a five-day split rendered as one
     * undifferentiated list. The per-day grouping is the entire reason the template
     * stores `days`, so discarding it here undid the point of the format.
     */
    const byDay = parsed.data.days
      .filter((day) => day.tasks.length > 0)
      .map((day) => ({ dayOfWeek: day.dayOfWeek, titles: day.tasks }));
    const taskCount = byDay.reduce((n, day) => n + day.titles.length, 0);

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.weeklyPlan.create({
        data: {
          userId: user.id,
          name: body.name ?? template!.name,
          category: template!.category,
          targetType: parsed.data.targetType,
          targetValue: parsed.data.targetValue,
          // Starts unmeasured. Carrying the source's figure would report one week's
          // work as another's.
          manualActual: null,
          startDate: planDayOnly(body.startDate),
          endDate: planDayOnly(body.endDate),
          goalId: body.goalId ?? null,
          projectId: body.projectId ?? null,
          days: parsed.data.days.length
            ? {
                create: parsed.data.days.map((day) => ({
                  dayOfWeek: day.dayOfWeek,
                  note: day.note ?? null,
                })),
              }
            : undefined,
        },
        select: { id: true },
      });

      if (taskCount > 0) {
        // One insert at a time so each generated id is available for its join row.
        // Re-querying afterwards by title and a recent-timestamp window would be
        // guesswork: two identical titles in one template, or two concurrent applies,
        // would attach the wrong row and the plan would list a task nobody made.
        //
        // `sortOrder` runs continuously across days, in template day order, so the
        // applied plan lists its tasks the way the template depicted them rather than
        // restarting at zero per column and interleaving them unpredictably.
        const links: { taskId: string; sortOrder: number; dayOfWeek: number }[] = [];
        let order = 0;
        for (const day of byDay) {
          for (const title of day.titles) {
            const task = await tx.task.create({
              data: { userId: user.id, title, status: "TODO", sortOrder: order },
              select: { id: true },
            });
            // The day the template depicted, preserved on the join row.
            links.push({ taskId: task.id, sortOrder: order, dayOfWeek: day.dayOfWeek });
            order += 1;
          }
        }

        await tx.weeklyPlanTask.createMany({
          data: links.map((link) => ({ weeklyPlanId: created.id, ...link })),
        });
      }

      return created;
    });

    return {
      plan: await loadNewPlan(user.id, plan.id),
      createdTasks: taskCount,
      // Always 0 — templates carry no task or habit ids by design. Reported so the
      // apply response has one shape whether or not anything was linked.
      skippedExisting: 0,
    };
  },
});

export const DELETE = withApi({
  method: "DELETE",
  params,
  rateLimit: LIMITS.write,
  async handler({ user, params }) {
    const template = await prisma.weeklyPlanTemplate.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true },
    });
    assertOwnership(template, user.id, "That template no longer exists.");

    await prisma.weeklyPlanTemplate.delete({ where: { id: template!.id } });

    return { id: template!.id, deleted: true };
  },
});