"use client";

import * as React from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { LogOut, Moon, Settings, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/overlays";
import { signOutAction } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

/** Two initials from a name, or a neutral glyph when there is no name. */
function initials(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/**
 * True only after hydration.
 *
 * The server cannot know the resolved theme, so rendering the real icon during
 * SSR would produce a hydration mismatch. `useSyncExternalStore` is used instead
 * of the usual `useState` + `useEffect` pair: it reads `false` on the server and
 * `true` on the client without a cascading render.
 */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useHydrated();

  // `hydrated` is folded into `isDark` rather than applied only to the icon.
  // The theme lives in localStorage, so the server has no way to know it: it
  // renders with `theme === undefined`, and a client that has "dark" stored
  // computes `isDark === true` on its very first render. Guarding only the icon
  // still mismatches on the `aria-label`, because the server emitted
  // "Switch to dark theme" while the client wants "Switch to light theme".
  // Making the whole branch depend on hydration gives both nodes the same
  // server-side value and lets React reconcile them without a warning.
  const isDark = hydrated && theme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}

export function UserMenu({
  name,
  email,
}: {
  name: string | null;
  email: string;
}) {
  const [pending, startTransition] = React.useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full",
            "bg-surface-2 text-[11px] font-semibold text-ink-muted",
            "ring-1 ring-line transition-colors hover:ring-line-strong",
            "focus-visible:ring-2 focus-visible:ring-lime/30 focus-visible:outline-none",
          )}
        >
          {initials(name, email)}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="normal-case">
          <span className="block truncate text-[13px] font-medium text-ink">
            {name ?? "Signed in"}
          </span>
          <span className="block truncate text-[11px] text-ink-subtle">{email}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        {/* One settings page, so one entry. There was a second "Profile" item
            pointing at `/settings/profile`, a route that has never existed — it
            404s, and `/settings` already opens on the account card. */}
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden />
            Account settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          destructive
          disabled={pending}
          onSelect={(event) => {
            // Sign-out is a server action, so the form must not be allowed to
            // navigate first and abort the request.
            event.preventDefault();
            startTransition(async () => {
              await signOutAction();
            });
          }}
        >
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ThemeToggle };
