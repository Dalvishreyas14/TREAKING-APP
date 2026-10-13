"use client";

import { Circle } from "lucide-react";

/**
 * Live password strength checklist.
 *
 * Shows the requirements as a checklist rather than a single "weak/strong"
 * verdict, because a verdict is opaque and a checklist tells the user exactly
 * what is still missing.
 */
export function PasswordRules({ rules }: { rules: string[] }) {
  if (rules.length === 0) return null;

  return (
    <ul className="grid grid-cols-1 gap-1 pt-0.5 sm:grid-cols-2">
      {rules.map((rule) => (
        <li key={rule} className="flex items-center gap-1.5 text-xs text-ink-subtle">
          <Circle className="size-3 shrink-0" aria-hidden />
          {rule}
        </li>
      ))}
    </ul>
  );
}
