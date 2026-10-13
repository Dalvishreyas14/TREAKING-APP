import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * ProgressRing - the primary "how am I doing" visual.
 *
 * Drawn as SVG so the stroke stays crisp at any size and the arc animates via a
 * single CSS transition on strokeDashoffset. The numeric value is rendered as
 * live text (not an SVG <text>) so it inherits app typography and stays
 * selectable and screen-reader friendly.
 */
export function ProgressRing({
  value,
  size = 120,
  thickness = 8,
  className,
  trackClassName,
  indicatorClassName,
  color = "var(--lime)",
  children,
  label,
  durationMs = 900,
}: {
  /** 0-100. Values outside the range are clamped rather than throwing. */
  value: number;
  size?: number;
  thickness?: number;
  className?: string;
  trackClassName?: string;
  indicatorClassName?: string;
  color?: string;
  children?: React.ReactNode;
  /** Accessible name. Defaults to "Progress". */
  label?: string;
  durationMs?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const center = size / 2;

  return (
    <div
      className={cn("relative inline-grid place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${label ?? "Progress"}: ${Math.round(clamped)} percent`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          className={cn("stroke-surface-3", trackClassName)}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: `stroke-dashoffset ${durationMs}ms var(--ease-out-expo)`,
            filter: `drop-shadow(0 0 5px color-mix(in oklab, ${color} 55%, transparent))`,
          }}
          className={cn(indicatorClassName)}
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 grid place-items-center">{children}</div>
      ) : null}
    </div>
  );
}

/** Compact variant used inside stat cards and list rows. */
export function MiniRing({
  value,
  size = 32,
  thickness = 3,
  color = "var(--lime)",
  className,
}: {
  value: number;
  size?: number;
  thickness?: number;
  color?: string;
  className?: string;
}) {
  return (
    <ProgressRing
      value={value}
      size={size}
      thickness={thickness}
      color={color}
      className={className}
      label="Completion"
      durationMs={600}
    />
  );
}
