"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Brain, CalendarPlus, Check, Loader2, MessageSquare, Plus, Send, Sparkles, Wand2 } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/auth/field";
import { Input } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/api/client";
import { formatLocalDayMonth } from "@/lib/format/date";
import { cn } from "@/lib/utils";

/**
 * The assistant screen.
 *
 * The whole screen is built around one rule: **nothing the assistant produces is
 * written until a person presses a button on that specific thing.** Three
 * surfaces produce drafts — a captured task, a planned block, a parsed sentence —
 * and each one renders as a card with its own accept button. There is no bulk
 * "apply everything", and there is deliberately no path that turns a reply into a
 * write without a click on the reply's own card.
 *
 * That is not caution for its own sake. The alternative is a planner that
 * silently rewrites someone's afternoon because a median estimate was off, and a
 * user who finds three phantom blocks in their calendar stops trusting the whole
 * feature — correctly.
 *
 * Two further details:
 *
 * **The answer is shown with its evidence.** `evidence` expands to the rows
 * behind the numbers. An assistant that says "you have 14 overdue tasks" with no
 * way to check is worse than no assistant.
 *
 * **Suggestions are chips, not commands.** They fill the composer and let the
 * user edit before sending. A suggestion that fires a request on click would be
 * an action the user never took.
 */

export interface AssistantMessageRow {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  source: string | null;
  provider: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface CaptureDraft {
  title: string;
  dueAt: string | null;
  priority: string;
  estimatedMinutes: number | null;
  confidence: number;
  /** Advisory ids from the server. Null means "no confident match", not "none exists". */
  suggestedCategoryId?: string | null;
  suggestedGoalId?: string | null;
}

interface Answer {
  reply: string;
  intent: string;
  citations: string[];
  evidence: Record<string, unknown>;
  capture: CaptureDraft | null;
  suggestions: string[];
}

interface PlanSlot {
  taskId: string;
  title: string;
  startMinutes: number;
  endMinutes: number;
  minutes: number;
  priority: string;
  dueAt: string | null;
  categoryName: string | null;
  reasons: string[];
}

interface PlanResult {
  date: string;
  availableMinutes: number;
  committedMinutes: number;
  proposedMinutes: number;
  remainingMinutes: number;
  slots: PlanSlot[];
  unplaced: { taskId: string; title: string; reason: string; minutes: number }[];
  rationale: string;
}

const EXAMPLES = [
  "what should I do right now?",
  "what is overdue?",
  "how are my habits doing?",
  "when do I focus best?",
  "what are my goals?",
];

export function AssistantPanel({
  conversations,
  activeConversationId,
  messages: initialMessages,
  aiEnabled,
  externalConsentGiven,
  categories,
  goals,
}: {
  conversations: { id: string; title: string | null; updatedAt: string }[];
  activeConversationId: string | null;
  messages: AssistantMessageRow[];
  aiEnabled: boolean;
  externalConsentGiven: boolean;
  categories: { id: string; name: string }[];
  goals: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [messages, setMessages] = React.useState(initialMessages);
  const [conversationId, setConversationId] = React.useState(activeConversationId);
  const [input, setInput] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [draft, setDraft] = React.useState<Answer | null>(null);
  const [tool, setTool] = React.useState<"CAPTURE" | "PLAN" | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const [syncedFrom, setSyncedFrom] = React.useState(initialMessages);
  if (syncedFrom !== initialMessages) {
    setSyncedFrom(initialMessages);
    setMessages(initialMessages);
  }

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    // The user's own message is appended immediately so the transcript shows the
    // question even if the request fails. The failure path removes it again —
    // showing a question the server never received would be a lie about what was
    // asked.
    const localId = `local-${Date.now()}`;
    const optimistic: AssistantMessageRow = {
      id: localId,
      role: "USER",
      content: trimmed,
      source: "LOCAL",
      provider: "local",
      latencyMs: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);

    try {
      const answer = await api.post<{
        conversationId: string;
        reply: string;
        intent: string;
        citations: string[];
        evidence: Record<string, unknown>;
        capture: Answer["capture"];
        suggestions: string[];
      }>("/api/v1/ai/chat", { message: trimmed, conversationId });

      setConversationId(answer.conversationId);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== localId),
        {
          ...optimistic,
          id: `user-${answer.conversationId}-${answer.reply.length}`,
        },
        {
          id: `assistant-${Date.now()}`,
          role: "ASSISTANT",
          content: answer.reply,
          source: "LOCAL",
          provider: "local",
          latencyMs: null,
          createdAt: new Date().toISOString(),
        },
      ]);
      setDraft(answer);
      router.refresh();
    } catch (error) {
      setMessages((prev) => prev.filter((m) => m.id !== localId));
      setInput(trimmed);
      toast.error(
        error instanceof ApiClientError ? error.message : "The assistant could not answer.",
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col gap-2 lg:w-60">
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => {
            setConversationId(null);
            setMessages([]);
            setDraft(null);
            router.push("/ai");
          }}
        >
          <Plus /> New conversation
        </Button>

        {conversations.length > 0 ? (
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto lg:max-h-96">
            {conversations.map((c) => (
              <a
                key={c.id}
                href={`/ai?c=${c.id}`}
                className={cn(
                  "flex flex-col gap-0.5 rounded-control px-2.5 py-2 transition-colors",
                  c.id === conversationId ? "bg-lime-soft" : "hover:bg-surface-2",
                )}
              >
                <span className="truncate text-[12px] font-medium text-ink">
                  {c.title ?? "Conversation"}
                </span>
                <span className="text-[10px] text-ink-subtle">
                  {formatLocalDayMonth(new Date(c.updatedAt))}
                </span>
              </a>
            ))}
          </div>
        ) : null}

        <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-3">
          <p className="text-[11px] text-ink-subtle">Tools</p>
          <Button
            size="xs"
            variant={tool === "CAPTURE" ? "secondary" : "ghost"}
            className="justify-start"
            onClick={() => setTool(tool === "CAPTURE" ? null : "CAPTURE")}
          >
            <Wand2 /> Capture a task
          </Button>
          <Button
            size="xs"
            variant={tool === "PLAN" ? "secondary" : "ghost"}
            className="justify-start"
            onClick={() => setTool(tool === "PLAN" ? null : "PLAN")}
          >
            <CalendarPlus /> Plan a day
          </Button>
        </div>

        <p className="mt-auto text-[10px] leading-relaxed text-ink-subtle">
          Local and deterministic. Nothing leaves this device, and no external
          provider consent has been given
          {externalConsentGiven ? " (though none is used)" : ""}.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {!aiEnabled ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={Brain}
                title="The assistant is switched off"
                description="Insights and the assistant are off in settings. Turn them on there and this page will answer from your data again. Nothing else about the app changes."
                action={{ label: "Open settings", href: "/settings" }}
              />
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
                  {messages.length === 0 ? (
                    <EmptyState
                      size="sm"
                      icon={MessageSquare}
                      title="Ask about your data"
                      description="Every answer is computed from your own tasks, habits, focus sessions and goals, and the evidence is shown underneath so you can check it."
                    />
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          "flex flex-col gap-1",
                          message.role === "USER" && "items-end",
                        )}
                      >
                        <span
                          className={cn(
                            "max-w-[85%] rounded-control px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
                            message.role === "USER"
                              ? "bg-lime text-ink-inverse"
                              : "border border-line bg-surface-2 text-ink",
                          )}
                        >
                          {message.content}
                        </span>
                        {message.role === "ASSISTANT" ? (
                          <span className="text-[10px] text-ink-subtle">
                            local · deterministic
                            {message.latencyMs != null ? ` · ${message.latencyMs}ms` : ""}
                          </span>
                        ) : null}
                      </div>
                    ))
                  )}
                  {sending ? (
                    <div className="flex items-center gap-2 text-[12px] text-ink-subtle">
                      <Loader2 className="size-3.5 animate-spin" />
                      Reading your data…
                    </div>
                  ) : null}
                  <div ref={bottomRef} />
                </div>

                {draft?.suggestions?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {draft.suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setInput(s)}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-lime hover:text-lime"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}

                {draft?.evidence && Object.keys(draft.evidence).length > 0 ? (
                  <details className="rounded-control border border-line bg-surface-2 p-2.5">
                    <summary className="cursor-pointer text-[11px] text-ink-muted">
                      How this was worked out
                    </summary>
                    <dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
                      {Object.entries(draft.evidence).map(([key, value]) => (
                        <div key={key} className="flex items-baseline justify-between gap-2">
                          <dt className="text-ink-subtle">
                            {key.replace(/([a-z])([A-Z])/g, "$1 $2")}
                          </dt>
                          <dd className="truncate tabular-nums text-ink">
                            {typeof value === "number"
                              ? Math.round(value * 100) / 100
                              : Array.isArray(value)
                                ? value.length
                                : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {draft.citations.length > 0 ? (
                      <p className="mt-2 text-[10px] text-ink-subtle">
                        From: {draft.citations.join(" · ")}
                      </p>
                    ) : null}
                  </details>
                ) : null}

                {draft?.capture ? (
                  <CaptureCard
                    capture={draft.capture}
                    categories={categories}
                    goals={goals}
                    onDone={() => setDraft((d) => (d ? { ...d, capture: null } : d))}
                  />
                ) : null}

                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(input);
                  }}
                >
                  <Field label="" error={undefined} className="flex-1">
                    <Input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="What should I do right now?"
                      maxLength={2000}
                      disabled={sending}
                    />
                  </Field>
                  <Button type="submit" variant="lime" disabled={sending || !input.trim()}>
                    <Send /> Ask
                  </Button>
                </form>

                {messages.length === 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => void send(example)}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-lime hover:text-lime"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {tool === "CAPTURE" ? <CaptureTool categories={categories} goals={goals} /> : null}
            {tool === "PLAN" ? <PlanTool /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function CaptureCard({
  capture,
  categories,
  goals,
  onDone,
}: {
  capture: CaptureDraft;
  categories: { id: string; name: string }[];
  goals: { id: string; title: string }[];
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  // The server already matched the sentence against this user's own taxonomy,
  // so its answer is the starting point. A suggestion is only honoured when the
  // id still resolves in the list rendered here — a goal that was closed between
  // parsing and rendering must fall back to unset rather than submit a stale id.
  const [categoryId, setCategoryId] = React.useState<string>(() =>
    capture.suggestedCategoryId && categories.some((c) => c.id === capture.suggestedCategoryId)
      ? capture.suggestedCategoryId
      : "",
  );
  const [goalId, setGoalId] = React.useState<string>(() =>
    capture.suggestedGoalId && goals.some((g) => g.id === capture.suggestedGoalId)
      ? capture.suggestedGoalId
      : "",
  );
  const categoryGuessed = categoryId !== "" && categoryId === capture.suggestedCategoryId;
  const goalGuessed = goalId !== "" && goalId === capture.suggestedGoalId;

  async function create() {
    setBusy(true);
    try {
      await api.post("/api/v1/tasks", {
        title: capture.title,
        dueAt: capture.dueAt,
        priority: capture.priority,
        estimatedMinutes: capture.estimatedMinutes,
        categoryId: categoryId || null,
        goalId: goalId || null,
      });
      toast.success("Task added.");
      onDone();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not create that task.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-control border border-lime bg-lime-soft p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-ink">Draft task</span>
        <Badge variant="limeSolid" size="sm">
          {Math.round(capture.confidence * 100)}% sure
        </Badge>
      </div>
      <p className="mt-1 text-[13px] text-ink">{capture.title}</p>
      <p className="mt-0.5 text-[11px] text-ink-muted">
        {capture.dueAt
          ? `Due ${formatLocalDayMonth(new Date(capture.dueAt))}`
          : "No date found"}
        {capture.estimatedMinutes ? ` · ~${capture.estimatedMinutes} min` : ""} ·{" "}
        {capture.priority.toLowerCase()}
      </p>

      {(categoryGuessed || goalGuessed) && (
        <p className="mt-1 text-[11px] text-ink-subtle">
          Matched to your own
          {categoryGuessed && goalGuessed ? " categories and goals" : categoryGuessed ? " categories" : " goals"}{" "}
          — change it if that is not right.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={busy}
          className="h-8 rounded-control border border-line bg-surface px-2 text-[12px] text-ink"
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
          disabled={busy}
          className="h-8 rounded-control border border-line bg-surface px-2 text-[12px] text-ink"
        >
          <option value="">No goal</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <Button size="xs" variant="lime" loading={busy} loadingText="Adding" onClick={create}>
          <Plus /> Add task
        </Button>
      </div>
    </div>
  );
}

function CaptureTool({
  categories,
  goals,
}: {
  categories: { id: string; name: string }[];
  goals: { id: string; title: string }[];
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<CaptureDraft | null>(null);

  async function parse() {
    setBusy(true);
    try {
      const result = await api.post<{ draft: CaptureDraft }>(
        "/api/v1/ai/parse-task",
        { text },
      );
      setDraft(result.draft);
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not read that.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capture a task from a sentence</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-muted">
          Dates, times, priority and estimates are read out of the sentence on this
          device. Nothing is created until you press Add.
        </p>
        <div className="flex items-end gap-2">
          <Field label="" error={undefined} className="flex-1">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="call the dentist friday at 10 urgent"
              maxLength={500}
              disabled={busy}
            />
          </Field>
          <Button variant="secondary" loading={busy} loadingText="Reading" onClick={parse} disabled={!text.trim()}>
            <Wand2 /> Parse
          </Button>
        </div>

        {draft ? (
          <CaptureCard
            capture={draft}
            categories={categories}
            goals={goals}
            onDone={() => setDraft(null)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function PlanTool() {
  const router = useRouter();
  const [date, setDate] = React.useState("");
  const [minutes, setMinutes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [plan, setPlan] = React.useState<PlanResult | null>(null);
  const [kept, setKept] = React.useState<Record<string, boolean>>({});
  const [inserting, setInserting] = React.useState<string | null>(null);

  async function build() {
    setBusy(true);
    setKept({});
    try {
      const result = await api.post<PlanResult>("/api/v1/ai/plan", {
        date: date || undefined,
        availableMinutes: minutes ? Number(minutes) : undefined,
      });
      setPlan(result);
      if (result.slots.length === 0) {
        toast.info("Nothing to place — no open tasks that fit, or the day is full.");
      }
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not build a plan.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function keep(slot: PlanSlot) {
    setInserting(slot.taskId);
    try {
      await api.post("/api/v1/time-blocks", {
        title: slot.title,
        date: plan!.date.slice(0, 10),
        startMinutes: slot.startMinutes,
        durationMinutes: slot.minutes,
        taskId: slot.taskId,
        // Blocks from a proposal are explicitly not locked: they are a
        // suggestion, and locking one would stop the user editing the very thing
        // they just accepted by accident.
        locked: false,
      });
      setKept((prev) => ({ ...prev, [slot.taskId]: true }));
      toast.success("Added to the planner.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not add that block.",
      );
    } finally {
      setInserting(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plan a day</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[12px] text-ink-muted">
          A proposal, not a schedule. Keeping a slot writes one block to the planner;
          nothing else is touched, and the plan can be rebuilt as often as you like.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Day" error={undefined}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field
            label="Minutes available"
            error={undefined}
            hint="Leave blank to use your working hours from settings."
          >
            <Input
              type="number"
              min={30}
              max={960}
              step={15}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              placeholder="—"
            />
          </Field>
          <Button variant="lime" loading={busy} loadingText="Planning" onClick={build}>
            <Sparkles /> Suggest a day
          </Button>
        </div>

        {plan ? (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <p className="text-[13px] text-ink">{plan.rationale}</p>

            <div className="flex flex-wrap gap-2 text-[11px] text-ink-subtle">
              <span>{plan.availableMinutes} min free</span>
              <span>· {plan.committedMinutes} min already blocked</span>
              <span>· {plan.proposedMinutes} min proposed</span>
              <span>· {plan.remainingMinutes} min left over</span>
            </div>

            {plan.slots.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {plan.slots.map((slot) => (
                  <li
                    key={slot.taskId}
                    className="flex items-start gap-3 rounded-control border border-line bg-surface-2 p-2.5"
                  >
                    <span className="w-24 shrink-0 text-[12px] tabular-nums text-ink-muted">
                      {formatMinutes(slot.startMinutes)}–{formatMinutes(slot.endMinutes)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{slot.title}</p>
                      <p className="text-[11px] text-ink-subtle">
                        {slot.minutes} min
                        {slot.categoryName ? ` · ${slot.categoryName}` : ""}
                        {slot.reasons.length ? ` · ${slot.reasons.join("; ")}` : ""}
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant={kept[slot.taskId] ? "ghost" : "secondary"}
                      disabled={kept[slot.taskId] || inserting === slot.taskId}
                      loading={inserting === slot.taskId}
                      loadingText="Adding"
                      onClick={() => void keep(slot)}
                    >
                      {kept[slot.taskId] ? <><Check /> Kept</> : <><Plus /> Keep</>}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            {plan.unplaced.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-[13px] font-medium text-ink-muted">Did not fit</p>
                {plan.unplaced.map((item) => (
                  <div key={item.taskId} className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="min-w-0 truncate text-ink-muted">{item.title}</span>
                    <span className="shrink-0 text-[11px] text-ink-subtle">{item.reason}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
