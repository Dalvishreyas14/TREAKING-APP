"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Check, Info, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, ApiClientError } from "@/lib/api/client";
import type { ActionChange, ActionPlan } from "@/lib/ai/actions";
import { cn } from "@/lib/utils";

/**
 * Preview a suggestion, then apply it in one tap.
 *
 * The two-step is the feature. `GET /action` returns a typed diff — every field
 * that would change, with its current value and its next one — and the confirm
 * happens after the user has read that diff. An insight never writes on its own,
 * and there is no path through this component that skips the read.
 *
 * The refusal case matters as much as the apply case. Plenty of good findings have
 * no change behind them — "your best focus is 9am" is true and actionable, but
 * there is no row to write — and an empty confirmation dialog with a live button
 * would be a lie. So `plan.applicable === false` renders the reason and offers no
 * button at all, which is also why the types carry `reason` as a required field
 * for the inapplicable branch rather than an optional message.
 *
 * The plan is fetched when the dialog opens, not before, so the numbers on screen
 * are the numbers the apply step will re-check. The server re-plans inside the
 * transaction regardless, and returns the diff it performed, so a change made in
 * another tab shows up as a 409 with a reason instead of a surprise.
 */

interface PreviewResponse {
  insightId: string;
  plan: ActionPlan;
}

const TARGET_LABEL: Record<ActionChange["target"], string> = {
  Task: "Task",
  Habit: "Habit",
  HabitLog: "Habit log",
  Goal: "Goal",
  Profile: "Profile",
};

function ChangeRow({ change }: { change: ActionChange }) {
  return (
    <li className="flex flex-col gap-1 border-t border-line py-2.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="outline" size="sm">
          {TARGET_LABEL[change.target]}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {change.targetLabel}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-0.5 text-[12px]">
        <span className="text-ink-subtle">{change.field}</span>
        <span className="text-ink-subtle line-through decoration-ink-subtle/60">
          {change.before ?? "not set"}
        </span>
        <ArrowRight aria-hidden className="size-3 shrink-0 text-ink-subtle" />
        <span className="font-medium text-ink">{change.after ?? "not set"}</span>
      </div>
    </li>
  );
}

export function ActionPreview({ insightId }: { insightId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [plan, setPlan] = React.useState<ActionPlan | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);

  async function openPreview() {
    setOpen(true);
    setLoading(true);
    setFailed(null);
    setPlan(null);
    try {
      const result = await api.get<PreviewResponse>(`/api/v1/insights/${insightId}/action`);
      setPlan(result.plan);
    } catch (error) {
      setFailed(
        error instanceof ApiClientError ? error.message : "Could not work out what this would change.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    setApplying(true);
    try {
      const result = await api.post<{ applied: number }>(`/api/v1/insights/${insightId}/action`);
      setOpen(false);
      toast.success(
        result.applied === 1
          ? "Applied. One change made."
          : `Applied. ${result.applied} changes made.`,
      );
      router.refresh();
    } catch (error) {
      // A 409 here is the good case working: something it named was already done.
      // Show the reason and close, because re-reading the diff would only produce
      // the same refusal again.
      if (error instanceof ApiClientError && error.code === "CONFLICT") {
        setOpen(false);
        toast.message("Nothing left to change", { description: error.message });
        router.refresh();
        return;
      }
      toast.error(
        error instanceof ApiClientError ? error.message : "Could not apply that suggestion.",
      );
    } finally {
      setApplying(false);
    }
  }

  const applicable = plan?.applicable === true;

  return (
    <>
      <Button
        size="xs"
        variant="secondary"
        onClick={() => void openPreview()}
        loading={loading && !open}
        loadingText="Checking"
      >
        <Wand2 /> Review &amp; apply
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {applicable ? plan.label : "Nothing to apply here"}
            </DialogTitle>
            <DialogDescription>
              {applicable
                ? "Check this before it happens. Nothing has changed yet."
                : "This suggestion is an observation rather than a change, so there is nothing to confirm."}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[46vh] overflow-y-auto">
            {loading ? (
              <p className="py-6 text-center text-[13px] text-ink-subtle">
                Working out what this would change…
              </p>
            ) : failed ? (
              <p className="py-6 text-center text-[13px] text-negative">{failed}</p>
            ) : plan && !plan.applicable ? (
              <div className="flex items-start gap-2.5 rounded-control border border-line bg-surface-2 p-3">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
                <p className="text-[13px] leading-relaxed text-ink-muted">{plan.reason}</p>
              </div>
            ) : plan ? (
              <>
                <p className="mb-2 text-[13px] leading-relaxed text-ink-muted">{plan.summary}</p>
                <ul className="flex flex-col">
                  {plan.changes.map((change) => (
                    <ChangeRow
                      key={`${change.target}-${change.targetId}-${change.field}`}
                      change={change}
                    />
                  ))}
                </ul>
              </>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={applying}>
              {applicable ? "Cancel" : "Close"}
            </Button>
            {applicable ? (
              <Button
                variant="lime"
                onClick={() => void confirm()}
                loading={applying}
                loadingText="Applying"
              >
                <Check /> Apply {plan.changes.length === 1 ? "this" : `these ${plan.changes.length} changes`}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Shown on an insight that has already been applied.
 *
 * The applied state is a record, so it reads as one — with the date it happened,
 * which is the only part of it that is still interesting a week later.
 */
export function ActionApplied({ actedAt }: { actedAt: string | null }) {
  return (
    <span className={cn("flex items-center gap-1.5 text-[11px] text-lime")}>
      <Check aria-hidden className="size-3" />
      Applied{actedAt ? ` ${new Date(actedAt).toLocaleDateString()}` : ""}
    </span>
  );
}
