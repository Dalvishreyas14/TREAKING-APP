import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { LIMITS } from "@/lib/rate-limit";
import { nlChatSchema } from "@/lib/validation/schemas";
import { loadSnapshot } from "@/lib/ai/snapshot";
import { askAssistant } from "@/lib/ai/assistant";
import { matchCategory, matchGoal } from "@/lib/ai/classify";

/**
 * POST /api/v1/ai/chat
 *
 * The assistant, over the caller's own data.
 *
 * Three things are deliberate here:
 *
 * 1. **The answer is computed, then stored.** The reply is produced by
 *    `askAssistant` from a snapshot, and only then written as a message. Nothing
 *    reaches the conversation history that did not come out of the analyser, so
 *    the transcript cannot drift away from what the data supports.
 * 2. **`source` is always `LOCAL`.** This build has no external provider. Recording
 *    that per message rather than inferring it later is what makes it auditable
 *    which engine produced which reply, and it leaves the field meaningful if a
 *    provider is ever added.
 * 3. **A capture is never auto-written.** `add buy milk` returns a draft the user
 *    accepts. Writing a task because a sentence started with "add" is how an
 *    assistant fills someone's list with things they never meant to keep.
 */

export const POST = withApi({
  method: "POST",
  body: nlChatSchema,
  rateLimit: LIMITS.aiChat,
  async handler({ user, body }) {
    const snapshot = await loadSnapshot(user.id);

    // `aiEnabled` is the user's own switch and is honoured. `aiConsentAt` is not
    // checked here, and the omission is intentional rather than an oversight:
    // consent gates *external* providers, and this build sends the user's data
    // nowhere. Requiring it would block every user who never ticked a box for a
    // provider this app does not use. The first route that actually reaches a
    // provider has to assert it, and `aiConsentAt` is the column to assert
    // against.
    if (!snapshot.profile.aiEnabled) {
      throw ApiError.aiUnavailable("Turn the assistant on in settings to use it.");
    }

    const answer = askAssistant(snapshot, body.message, new Date());

    // The conversation is only created if one is not already known, and a
    // caller-supplied id is never trusted: an id belonging to another user would
    // otherwise append this exchange to their history.
    let conversationId = body.conversationId ?? null;
    if (conversationId) {
      const owned = await prisma.aIConversation.findFirst({
        where: { id: conversationId, userId: user.id },
        select: { id: true },
      });
      if (!owned) conversationId = null;
    }

    if (!conversationId) {
      const created = await prisma.aIConversation.create({
        data: {
          userId: user.id,
          title: body.message.slice(0, 80),
          provider: "local",
        },
        select: { id: true },
      });
      conversationId = created.id;
    }

    const startedAt = Date.now();

    const [userMessage, assistantMessage] = await prisma.$transaction([
      prisma.aIMessage.create({
        data: {
          userId: user.id,
          conversationId,
          role: "USER",
          content: body.message,
          source: "LOCAL",
          provider: "local",
        },
        select: { id: true, createdAt: true },
      }),
      prisma.aIMessage.create({
        data: {
          userId: user.id,
          conversationId,
          role: "ASSISTANT",
          content: answer.reply,
          source: "LOCAL",
          provider: "local",
          latencyMs: Date.now() - startedAt,
        },
        select: { id: true, createdAt: true },
      }),
    ]);

    // Touch the conversation so the transcript list is ordered by recency of
    // activity rather than by when the thread was opened.
    await prisma.aIConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    // A capture routed through chat gets the same category and goal suggestions
    // as one from the parse endpoint. `askAssistant` is a pure function over the
    // snapshot and cannot see the taxonomy, so the classification happens here
    // against the same matchers both paths share. Two capture UIs that disagreed
    // about where a task belonged would be a bug, not a difference.
    const capture = answer.capture
      ? await suggestPlacement(user.id, answer.capture, body.message)
      : null;

    return {
      conversationId,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      intent: answer.intent,
      reply: answer.reply,
      citations: answer.citations,
      evidence: answer.evidence,
      capture,
      suggestions: answer.suggestions,
      source: "LOCAL" as const,
    };
  },
});

/**
 * Attach advisory category/goal ids to a parsed draft.
 *
 * Never throws and never blocks the answer: the taxonomy queries are a
 * convenience for the draft card, and an assistant reply is worth showing even
 * if the dropdowns have to fall back to "no suggestion".
 */
async function suggestPlacement(
  userId: string,
  parsed: NonNullable<ReturnType<typeof askAssistant>["capture"]>,
  source: string,
) {
  try {
    const [categories, goals] = await Promise.all([
      prisma.category.findMany({
        where: { userId },
        select: { id: true, name: true },
      }),
      prisma.goal.findMany({
        where: { userId, status: "ACTIVE" },
        select: { id: true, title: true, targetDate: true },
        orderBy: { targetDate: "asc" },
        take: 20,
      }),
    ]);

    return {
      ...parsed,
      dueAt: parsed.dueAt?.toISOString() ?? null,
      suggestedCategoryId: matchCategory(categories, parsed.title, source),
      suggestedGoalId: matchGoal(goals, parsed, source),
    };
  } catch {
    return {
      ...parsed,
      dueAt: parsed.dueAt?.toISOString() ?? null,
      suggestedCategoryId: null,
      suggestedGoalId: null,
    };
  }
}
