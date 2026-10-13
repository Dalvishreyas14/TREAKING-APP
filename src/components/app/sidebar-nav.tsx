"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { NAV, SETTINGS_NAV, isActiveItem } from "@/lib/nav";

/**
 * Primary navigation.
 *
 * Rendered as a list of links rather than a router-aware menu: the current route
 * is communicated with `aria-current`, so a screen reader announces the position
 * without the visual treatment being the only signal.
 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {NAV.map((group) => (
        <div key={group.id}>
          <h2 className="px-3 pb-2 text-[11px] font-semibold tracking-[0.09em] text-ink-subtle uppercase">
            {group.label}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = isActiveItem(item, pathname);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-control px-3 py-2",
                      "text-[13px] transition-colors duration-150",
                      "focus-visible:ring-2 focus-visible:ring-lime/30 focus-visible:outline-none",
                      active
                        ? "bg-surface-2 font-medium text-ink"
                        : "text-ink-muted hover:bg-surface-2/60 hover:text-ink",
                    )}
                  >
                    {/*
                      The active marker is a bar rather than a background tint on
                      its own: colour alone would not distinguish the two states for
                      anyone who cannot perceive the hue.
                    */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 h-5 w-[2px] rounded-full bg-lime transition-opacity duration-150",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Icon
                      aria-hidden
                      className={cn(
                        "size-[17px] shrink-0 transition-colors",
                        active ? "text-lime" : "text-ink-subtle group-hover:text-ink-muted",
                      )}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function SidebarSettingsLink({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === SETTINGS_NAV.href;
  const Icon = SETTINGS_NAV.icon;

  return (
    <Link
      href={SETTINGS_NAV.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-control px-3 py-2 text-[13px] transition-colors",
        "focus-visible:ring-2 focus-visible:ring-lime/30 focus-visible:outline-none",
        active
          ? "bg-surface-2 font-medium text-ink"
          : "text-ink-muted hover:bg-surface-2/60 hover:text-ink",
      )}
    >
      <Icon aria-hidden className="size-[17px] shrink-0 text-ink-subtle" />
      {SETTINGS_NAV.label}
    </Link>
  );
}
