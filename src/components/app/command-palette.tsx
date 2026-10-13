"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { rankMatches, type Matchable } from "@/lib/command-match";
import { NAV, SETTINGS_NAV, type NavItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * The command palette.
 *
 * Built on a plain controlled input rather than a combobox library for the same
 * reason as the matcher: the behaviour needed here is a filtered list with
 * arrow-key selection, which is about eighty lines and fully under our control.
 * The listbox roles and `aria-activedescendant` wiring below are what make it
 * usable with a screen reader, and are the part most worth keeping intact.
 *
 * State lives in `PaletteBody`, which is mounted only while the dialog is open.
 * That is what resets the query between openings, rather than an effect that
 * clears it afterwards.
 */

interface PaletteEntry extends Matchable {
  href: string;
  icon: NavItem["icon"];
  group: string;
}

const ENTRIES: PaletteEntry[] = [
  ...NAV.flatMap((group) =>
    group.items.map((item) => ({
      href: item.href,
      icon: item.icon,
      group: group.label,
      label: item.label,
      keywords: item.keywords,
    })),
  ),
  {
    href: SETTINGS_NAV.href,
    icon: SETTINGS_NAV.icon,
    group: "Account",
    label: SETTINGS_NAV.label,
    keywords: SETTINGS_NAV.keywords,
  },
];

function PaletteBody({ onDismiss }: { onDismiss: () => void }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);

  const results = React.useMemo(() => rankMatches(ENTRIES, query, 8), [query]);

  // Clamp rather than correct in an effect: narrowing the result list moves the
  // highlight back into range without a second render pass.
  const selected = results.length > 0 ? Math.min(active, results.length - 1) : 0;

  function go(href: string) {
    onDismiss();
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length) setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length) setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const chosen = results[selected];
      if (chosen) go(chosen.item.href);
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search aria-hidden className="size-4 shrink-0 text-ink-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Typing invalidates the previous position, so start from the top.
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search or jump to…"
          aria-label="Search destinations"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="palette-list"
          aria-activedescendant={
            results[selected] ? `palette-option-${selected}` : undefined
          }
          aria-autocomplete="list"
          className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-ink-subtle"
        />
      </div>

      <ul
        id="palette-list"
        role="listbox"
        aria-label="Destinations"
        className="max-h-[min(50dvh,22rem)] overflow-y-auto p-2"
      >
        {results.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-ink-subtle">
            Nothing matches “{query.trim()}”.
          </li>
        ) : (
          results.map((scored, index) => {
            const { item } = scored;
            const Icon = item.icon;
            const isSelected = index === selected;
            return (
              <li key={item.href} role="none">
                <button
                  type="button"
                  id={`palette-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  // Hover moves the highlight so the mouse and the keyboard are
                  // never pointing at different rows.
                  onMouseMove={() => setActive(index)}
                  onClick={() => go(item.href)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left",
                    "text-[13px] transition-colors",
                    isSelected ? "bg-surface-2 text-ink" : "text-ink-muted",
                  )}
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0",
                      isSelected ? "text-lime" : "text-ink-subtle",
                    )}
                  />
                  <span className="flex-1 truncate font-medium">{item.label}</span>
                  <span className="shrink-0 text-[11px] text-ink-subtle">
                    {item.group}
                  </span>
                  {isSelected ? (
                    <CornerDownLeft
                      aria-hidden
                      className="size-3.5 shrink-0 text-ink-subtle"
                    />
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        hideClose
        // Anchored near the top: a centred dialog puts the list under the
        // pointer's resting place, which is where people look first.
        className="top-[18%] max-h-[60dvh] translate-y-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Search and navigate</DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter destinations. Use the arrow keys to choose, then press
          Enter to open.
        </DialogDescription>
        {open ? <PaletteBody onDismiss={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
