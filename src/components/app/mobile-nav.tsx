"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { MOBILE_PRIMARY, isActiveItem } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Bottom navigation for small screens.
 *
 * Only four destinations, because a fifth stops being tappable. Everything else
 * is reachable from the command palette or the "More" sheet, which is the right
 * trade: a thumb reaches the bottom of the screen far more reliably than the top.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md",
        // Respect the safe area so the bar clears the home indicator on a phone.
        "pb-[env(safe-area-inset-bottom)]",
        "lg:hidden",
      )}
    >
      <ul className="grid grid-cols-4">
        {MOBILE_PRIMARY.map((item) => {
          const active = isActiveItem(item, pathname);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 px-1 pb-2 pt-1.5",
                  "text-[10px] transition-colors",
                  "focus-visible:ring-2 focus-visible:ring-lime/30 focus-visible:outline-none",
                  active ? "font-medium text-lime" : "text-ink-subtle hover:text-ink-muted",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-12 place-items-center rounded-full transition-colors",
                    active && "bg-lime-soft",
                  )}
                >
                  <Icon aria-hidden className="size-[19px]" />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
