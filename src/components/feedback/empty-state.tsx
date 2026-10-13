import * as React from "react";
import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * EmptyState is the single answer to "there is nothing here yet". Every list in
 * the product routes through it so the product never renders a bare blank panel
 * and never shows a raw technical error.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  size = "md",
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: { label: string; onClick?: () => void; href?: string };
  secondaryAction?: { label: string; onClick?: () => void; href?: string };
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = {
    sm: { wrap: "size-10 rounded-control", icon: "size-4.5" },
    md: { wrap: "size-12 rounded-card", icon: "size-5" },
    lg: { wrap: "size-16 rounded-[20px]", icon: "size-7" },
  }[size];

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        size === "lg" ? "gap-4 px-6 py-14" : "gap-3 px-5 py-10",
        className,
      )}
    >
      <div
        className={cn(
          "grid place-items-center border border-line text-lime",
          dims.wrap,
        )}
        style={{
          backgroundImage:
            "radial-gradient(120% 120% at 50% 0%, var(--lime-soft), var(--surface-2))",
        }}
        aria-hidden
      >
        <Icon className={dims.icon} />
      </div>
      <div className="max-w-sm space-y-1.5">
        <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
          {title}
        </p>
        {description ? (
          <p className="text-sm leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action ? (
            <Button
              variant="lime"
              size="sm"
              {...(action.href
                ? { asChild: true }
                : { onClick: action.onClick })}
            >
              {action.href ? (
                <a href={action.href}>{action.label}</a>
              ) : (
                action.label
              )}
            </Button>
          ) : null}
          {secondaryAction ? (
            <Button
              variant="ghost"
              size="sm"
              {...(secondaryAction.href
                ? { asChild: true }
                : { onClick: secondaryAction.onClick })}
            >
              {secondaryAction.href ? (
                <a href={secondaryAction.href}>{secondaryAction.label}</a>
              ) : (
                secondaryAction.label
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * MetricDisclosure is a compliance requirement, not decoration.
 *
 * LIFEOS computes scores like "Life Balance" and surfaces observations like
 * "your completion is higher on days you exercise". None of that is a
 * validated clinical or scientific measure, so wherever such a number is shown
 * the product states its provenance inline. This component is the single place
 * that wording lives.
 */
export function MetricDisclosure({
  variant = "balance",
  className,
}: {
  variant?: "balance" | "insight" | "wellbeing" | "forecast";
  className?: string;
}) {
  const text = {
    balance:
      "Life Balance is an application-generated metric derived from your own logged activity and the category weights you set. It is not a validated clinical or scientific measure.",
    insight:
      "Patterns are observations computed from your own logged data. Correlation is not evidence of causation, and these are not medical or psychological conclusions.",
    wellbeing:
      "Mood, energy and stress tracking is for personal reflection only. It is not a medical assessment and does not diagnose any condition.",
    forecast:
      "Projections are simple trend extrapolations from limited history. Treat them as a rough signal, not a prediction.",
  }[variant];

  return (
    <p
      className={cn(
        "text-[11px] leading-relaxed text-ink-subtle",
        className,
      )}
    >
      {text}
    </p>
  );
}
