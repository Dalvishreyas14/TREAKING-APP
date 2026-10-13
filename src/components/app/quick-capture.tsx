"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api, ApiClientError } from "@/lib/api/client";
import { toLocalDateTimeInput, fromLocalDateTimeInput } from "@/lib/date";

/**
 * Quick capture, available from any screen.
 *
 * A single title field and an optional due time, submit-on-Enter, and no
 * category/goal/subtask pickers. The point is to catch a thought in the two
 * seconds it takes to remember it; anything that makes you choose a category
 * first is friction that loses the capture. Richer editing stays on /tasks,
 * which this links to once the item exists.
 *
 * Enter submits, Shift+Enter saves and starts another — capturing a burst of
 * three thoughts should not mean three dialogs.
 */

type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "URGENT", label: "Urgent" },
];

export function QuickCapture({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [priority, setPriority] = React.useState<Priority>("MEDIUM");
  const [dueAt, setDueAt] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [lastTitle, setLastTitle] = React.useState<string | null>(null);

  function reset() {
    setTitle("");
    setDueAt("");
    setError(null);
    setPriority("MEDIUM");
  }

  async function save(keepOpen: boolean) {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Type something first.");
      return;
    }
    // Resolve the local wall-clock string to a real instant before touching the
    // API, so a bad value surfaces as a message instead of a server 400.
    const due = dueAt ? fromLocalDateTimeInput(dueAt) : null;
    if (dueAt && !due) {
      setError("That due time doesn't look right.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const task = await api.post<{ id: string; title: string }>("/api/v1/tasks", {
        title: trimmed,
        priority,
        ...(due ? { dueAt: due.toISOString() } : {}),
      });
      setLastTitle(task.title);
      reset();
      // The shell wraps every authenticated page, so refreshing is what makes a
      // capture show up on the dashboard and task list behind the dialog.
      router.refresh();
      toast.success("Captured.", {
        description: due ? "With a due time." : undefined,
        action: { label: "Open tasks", onClick: () => router.push("/tasks") },
      });
      if (!keepOpen) onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? (err.fieldErrors.title ?? err.message)
          : "Could not save that.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent size="sm">
        <DialogTitle>Quick capture</DialogTitle>
        <DialogDescription className="mt-1.5">
          Gets it out of your head. Everything else can be edited on the tasks
          screen.
        </DialogDescription>

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                void save(true);
              }
            }}
            placeholder="What needs doing?"
            aria-label="Task title"
            aria-invalid={error !== null}
            className="h-10 rounded-control border border-line bg-canvas px-3 text-[14px] outline-none focus:border-lime"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="qc-priority" className="text-[12px] text-ink-muted">
                Priority
              </label>
              <select
                id="qc-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="h-9 rounded-control border border-line bg-canvas px-2 text-[13px] outline-none focus:border-lime"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="qc-due" className="text-[12px] text-ink-muted">
                Due <span className="text-ink-subtle">(optional)</span>
              </label>
              <input
                id="qc-due"
                type="datetime-local"
                value={dueAt}
                min={toLocalDateTimeInput(new Date())}
                onChange={(e) => setDueAt(e.target.value)}
                className="h-9 rounded-control border border-line bg-canvas px-2 text-[13px] outline-none focus:border-lime"
              />
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-control border border-negative/30 bg-negative/8 px-3 py-2 text-[13px] text-negative"
            >
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="lime" size="sm" loading={pending}>
              <Plus aria-hidden />
              Save
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => void save(true)}
              title="Save and capture another (Shift+Enter)"
            >
              Save &amp; add another
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
          </div>

          <p className="text-[11px] text-ink-subtle">
            <kbd className="rounded border border-line px-1 py-0.5">Enter</kbd> to
            save,{" "}
            <kbd className="rounded border border-line px-1 py-0.5">
              Shift + Enter
            </kbd>{" "}
            to add another.
          </p>
        </form>

        {lastTitle ? (
          <p className="mt-4 border-t border-line pt-3 text-[12px] text-ink-subtle">
            Last captured:{" "}
            <Link
              href="/tasks"
              className="text-ink-muted underline underline-offset-2 hover:text-ink"
              onClick={() => onOpenChange(false)}
            >
              {lastTitle}
            </Link>
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
