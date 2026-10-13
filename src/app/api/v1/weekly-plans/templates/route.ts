import { z } from "zod";

import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { weeklyPlanTemplateSchema } from "@/lib/validation/schemas";

/**
 * GET /api/v1/weekly-plans/templates    POST /api/v1/weekly-plans/templates
 *
 * ## Why a template stores titles and never ids
 *
 * `WeeklyPlanTemplate.configuration` holds `{ targetType, targetValue, days: [{ dayOfWeek,
 * note, tasks: string[] }] }` and nothing else. That constraint is the entire
 * design of the table, and it is worth stating plainly because the alternative looks
 * better and is worse.
 *
 * A template that remembered which tasks it pointed at would need those tasks to
 * still exist. They will not always: the user deletes "Revise chapter 4" on Sunday
 * and applies "Weekly study plan" on Monday, and the template now holds a dangling
 * id. The failure is silent and slow — no error, the template still applies, it just
 * quietly contributes one fewer task than it displays. The user cannot tell that
 * from the outside, and a tracker that quietly under-reports is worse than one that
 * forgets.
 *
 * Titles cannot go stale. Applying a template always produces exactly what the
 * template depicts, and any divergence is visible immediately because it is the
 * user's own wording on screen.
 *
 * The cost is honest and worth naming: applying a template creates *new* tasks rather
 * than reattaching old ones, for the same reason `POST /weekly-plans/:id/copy` does.
 * Completion is a fact about a task, so a reused task would carry last week's DONE
 * into this week.
 *
 * The whole template is one document because the target and the days have to be read
 * together. Splitting the target into columns would mean an apply could take its
 * days from one place and its target from another and produce a plan that is half
 * one template and half another.
 */

/** The stored shape, re-parsed on read because a `Json` column can predate a schema. */
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

export const GET = withApi({
  method: "GET",
  async handler({ user }) {
    const templates = await prisma.weeklyPlanTemplate.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    return {
      items: templates.map((template) => {
        // Parsed, never cast. A row written before this schema existed, or edited
        // outside the app, must not be able to crash the picker. The cost of
        // tolerating it is showing one template with no tasks, which the user can
        // delete and which is recoverable — the cost of not tolerating it is the
        // whole template list failing to render.
        const parsed = templateConfigurationSchema.safeParse(template.configuration);
        return {
          id: template.id,
          name: template.name,
          category: template.category,
          days: parsed.success ? parsed.data.days : [],
          targetType: parsed.success ? parsed.data.targetType : "HOURS",
          targetValue: parsed.success ? parsed.data.targetValue : 0,
          unreadable: !parsed.success,
          createdAt: template.createdAt.toISOString(),
        };
      }),
    };
  },
});

export const POST = withApi({
  method: "POST",
  body: weeklyPlanTemplateSchema,
  rateLimit: LIMITS.write,
  async handler({ user, body }) {
    const template = await prisma.weeklyPlanTemplate.create({
      data: {
        userId: user.id,
        name: body.name,
        category: body.category,
        configuration: {
          targetType: body.targetType,
          targetValue: body.targetValue,
          days: body.days,
        },
      },
      select: { id: true, name: true, category: true },
    });

    return template;
  },
});