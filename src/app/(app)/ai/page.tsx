import { AssistantPanel, type AssistantMessageRow } from "@/components/app/assistant-panel";
import { requireUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { formatIndianLong } from "@/lib/format/date";

export const dynamic = "force-dynamic";

/**
 * The assistant.
 *
 * Three tools live on one screen because they share the same input — a sentence
 * about your day — and the same constraint: each returns a *draft*.
 *
 * - **Ask.** `POST /api/v1/ai/chat` classifies the question, answers it from a
 *   snapshot, and records both messages. The reply is computed before it is
 *   stored, so the transcript can only ever contain answers the analyser
 *   actually produced.
 * - **Capture.** `POST /api/v1/ai/parse-task` turns a sentence into a task draft.
 *   There is no `?create=true`; the task is created only when the user presses
 *   the button on the draft card.
 * - **Plan.** `POST /api/v1/ai/plan` returns candidate blocks. Keeping a slot
 *   posts to `POST /api/v1/time-blocks`; nothing is inserted automatically.
 *
 * The conversation is chosen with `?c=`, so a thread is linkable and the back
 * button moves between threads. `aiEnabled` is read from the database rather than
 * inferred from the session, because it is a user setting the user can change at
 * any time and the screen has to agree with what the API will actually allow.
 */

const MESSAGE_TAKE = 200;

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const [conversations, account, categories, goals] = await Promise.all([
    prisma.aIConversation.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, title: true, updatedAt: true, provider: true },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { aiEnabled: true, aiConsentAt: true },
    }),
    prisma.category.findMany({
      where: { OR: [{ userId: user.id }, { userId: null }] },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.goal.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { targetDate: "asc" },
      take: 20,
      select: { id: true, title: true },
    }),
  ]);

  // A thread id in the URL is only honoured if it belongs to this user, so a
  // pasted link cannot open somebody else's transcript.
  const requested = params.c ? conversations.find((c) => c.id === params.c) : undefined;
  const active = requested ?? conversations[0] ?? null;

  const messages = active
    ? await prisma.aIMessage.findMany({
        where: { userId: user.id, conversationId: active.id },
        orderBy: { createdAt: "asc" },
        take: MESSAGE_TAKE,
        select: {
          id: true,
          role: true,
          content: true,
          source: true,
          provider: true,
          latencyMs: true,
          createdAt: true,
        },
      })
    : [];

  const rows: AssistantMessageRow[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    source: m.source,
    provider: m.provider,
    latencyMs: m.latencyMs,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">AI Assistant</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Answers computed on this device from your own data. {formatIndianLong(new Date())}.
        </p>
      </header>

      <AssistantPanel
        conversations={conversations.map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt.toISOString(),
        }))}
        activeConversationId={active?.id ?? null}
        messages={rows}
        aiEnabled={account?.aiEnabled ?? false}
        externalConsentGiven={!!account?.aiConsentAt}
        categories={categories}
        goals={goals}
      />
    </div>
  );
}
