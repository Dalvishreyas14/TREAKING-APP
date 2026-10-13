import { withApi } from "@/lib/api/with-api";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { nlTaskSchema } from "@/lib/validation/schemas";
import { parseTaskText } from "@/lib/ai/task-parser";
import { matchCategory, matchGoal } from "@/lib/ai/classify";

/**
 * POST /api/v1/ai/parse-task
 *
 * Turns a sentence into a reviewable task draft, plus a suggestion for where it
 * belongs.
 *
 * There is deliberately no `?create=true`. This endpoint only ever *proposes*;
 * creating the task is a separate call to `POST /api/v1/tasks` with the draft the
 * user confirmed. A parser that can write is a parser that will eventually write
 * something nobody wanted, and the confirmation step is the whole protection.
 *
 * The split is: `parseTaskText` reads the sentence, and the matchers in
 * `src/lib/ai/classify.ts` place the result against what the user already has.
 * Both the same task-parsing path and the chat endpoint use those matchers, so a
 * draft suggested in the sidebar and one suggested mid-conversation classify
 * identically.
 *
 * Suggestions are advisory ids. A client that ignores them must still be able to
 * create the task, and a wrong guess is a wrong label the user can change, not
 * data written to the wrong place.
 */

export const POST = withApi({
  method: "POST",
  body: nlTaskSchema,
  rateLimit: LIMITS.nlParse,
  async handler({ user, body }) {
    const draft = parseTaskText(body.text, new Date());

    const [categories, goals] = await Promise.all([
      prisma.category.findMany({
        where: { userId: user.id },
        select: { id: true, name: true },
      }),
      prisma.goal.findMany({
        where: { userId: user.id, status: "ACTIVE" },
        select: { id: true, title: true, targetDate: true },
        orderBy: { targetDate: "asc" },
        take: 20,
      }),
    ]);

    return {
      draft: {
        ...draft,
        dueAt: draft.dueAt?.toISOString() ?? null,
        suggestedCategoryId: matchCategory(categories, draft.title, body.text),
        suggestedGoalId: matchGoal(goals, draft, body.text),
      },
      source: "LOCAL" as const,
    };
  },
});
