"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/auth/field";
import { Input, Textarea } from "@/components/ui/input";
import { api, ApiClientError } from "@/lib/api/client";

/**
 * Today's journal entry.
 *
 * The entry is written on an explicit save, not on a debounce. Journal text is
 * the most personal thing in the product and a person is mid-thought most of the
 * time while writing it; an autosave that truncates the tail on every network
 * hiccup is worse than an explicit button. The dirty state is made obvious
 * instead so "I have to remember to press save" is never a surprise.
 *
 * Creating and updating are both handled here, keyed on whether an entry for
 * today already exists. The user never sees an id, because the thing being
 * written is "today's entry" rather than a particular row.
 */

export interface JournalRow {
  id: string;
  date: string;
  title: string | null;
  content: string;
  mood: number | null;
  energy: number | null;
  tags: string[];
  wordCount: number;
}

export function JournalEditor({ todayEntry }: { todayEntry: JournalRow | null }) {
  const router = useRouter();
  const [title, setTitle] = React.useState(todayEntry?.title ?? "");
  const [content, setContent] = React.useState(todayEntry?.content ?? "");
  const [mood, setMood] = React.useState<number | null>(todayEntry?.mood ?? null);
  const [energy, setEnergy] = React.useState<number | null>(todayEntry?.energy ?? null);
  const [tags, setTags] = React.useState(todayEntry?.tags.join(", ") ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * A `router.refresh()` delivers a new `todayEntry`. Adjusting state during
   * render rather than in an effect is React's documented way to reset state
   * from a prop, and it avoids committing the stale text for a frame first.
   */
  const [syncedFrom, setSyncedFrom] = React.useState(todayEntry);
  if (syncedFrom !== todayEntry) {
    setSyncedFrom(todayEntry);
    setTitle(todayEntry?.title ?? "");
    setContent(todayEntry?.content ?? "");
    setMood(todayEntry?.mood ?? null);
    setEnergy(todayEntry?.energy ?? null);
    setTags(todayEntry?.tags.join(", ") ?? "");
  }

  const baseline = JSON.stringify({
    t: todayEntry?.title ?? "",
    c: todayEntry?.content ?? "",
    m: todayEntry?.mood ?? null,
    e: todayEntry?.energy ?? null,
    g: todayEntry?.tags.join(", ") ?? "",
  });
  const dirty =
    JSON.stringify({ t: title, c: content, m: mood, e: energy, g: tags }) !== baseline;

  const wordCount = React.useMemo(
    () => content.trim().split(/\s+/).filter(Boolean).length,
    [content],
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Always POST, even for an existing entry: the route is an upsert keyed on
      // `(userId, date)`, so a day holds exactly one entry either way. Branching
      // on whether the row exists would only create a second code path for the
      // same write, and the case where the local copy has no entry but the
      // server does — a write from another tab — is exactly the one that must not
      // fail.
      await api.post("/api/v1/journal", {
        date: todayEntry?.date ?? new Date().toISOString().slice(0, 10),
        title: title.trim() || null,
        content,
        mood,
        energy,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 12),
      });

      toast.success(todayEntry ? "Entry updated." : "Entry saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save the entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {todayEntry ? "Today's entry" : "Write today's entry"}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Field label="Title" error={error ?? undefined} hint={error ? undefined : "Optional."}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="A line to find it by later"
            maxLength={200}
            disabled={busy}
          />
        </Field>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-muted">Entry</span>
          <Textarea
            rows={10}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What happened, and how it felt."
            disabled={busy}
          />
          <span className="min-h-4 text-xs text-ink-subtle">
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <ScaleField
            label="Mood"
            value={mood}
            onChange={setMood}
            disabled={busy}
            lowLabel="Low"
            highLabel="Good"
          />
          <ScaleField
            label="Energy"
            value={energy}
            onChange={setEnergy}
            disabled={busy}
            lowLabel="Flat"
            highLabel="High"
          />
        </div>

        <Field
          label="Tags"
          hint="Comma separated. These show in the list and are searchable."
        >
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="work, family, rest"
            disabled={busy}
          />
        </Field>

        <div className="flex items-center justify-end gap-3">
          {dirty ? (
            <span className="text-xs text-ink-subtle">Unsaved changes</span>
          ) : null}
          <Button
            variant="lime"
            onClick={save}
            loading={busy}
            loadingText="Saving"
            disabled={!content.trim() || (!dirty && todayEntry !== null)}
          >
            <Save /> {todayEntry ? "Save changes" : "Save entry"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** A 1-5 scale that is clearable, so a mistaken tap is not permanent. */
function ScaleField({
  label,
  value,
  onChange,
  disabled,
  lowLabel,
  highLabel,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  lowLabel: string;
  highLabel: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[13px] font-medium text-ink-muted">{label}</legend>
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={() => onChange(value === n ? null : n)}
            aria-pressed={value === n}
            className={`h-9 flex-1 rounded-control border text-[13px] font-medium transition-colors disabled:opacity-50 ${
              value === n
                ? "border-lime bg-lime text-ink-inverse"
                : "border-line bg-surface text-ink-muted hover:border-line-strong"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-ink-subtle">
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </fieldset>
  );
}
