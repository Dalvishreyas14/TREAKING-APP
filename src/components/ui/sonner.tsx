"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Sonner is wrapped rather than used directly so notification styling stays
 * coupled to the design tokens instead of drifting into ad-hoc CSS.
 */
export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-right"
      offset={16}
      gap={8}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast:
            "group rounded-card border border-line bg-surface text-ink shadow-pop " +
            "data-[state=open]:animate-scale-in",
          description: "text-ink-muted",
          actionButton:
            "rounded-control bg-lime px-2.5 py-1 text-xs font-medium text-ink-inverse",
          cancelButton:
            "rounded-control border border-line px-2.5 py-1 text-xs text-ink-muted",
          closeButton: "border-line text-ink-subtle hover:text-ink",
          success: "[&_[data-icon]]:text-positive",
          error: "[&_[data-icon]]:text-negative",
          warning: "[&_[data-icon]]:text-warning",
        },
      }}
      {...props}
    />
  );
}
