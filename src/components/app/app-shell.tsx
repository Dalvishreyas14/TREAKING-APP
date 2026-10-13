"use client";

import * as React from "react";
import { Command, Menu, Plus, X } from "lucide-react";

import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { CommandPalette } from "./command-palette";
import { InstallPrompt } from "./install-prompt";
import { MobileNav } from "./mobile-nav";
import { QuickCapture } from "./quick-capture";
import { SidebarNav, SidebarSettingsLink } from "./sidebar-nav";
import { ThemeToggle, UserMenu } from "./user-menu";
import { cn } from "@/lib/utils";

/**
 * The authenticated application shell.
 *
 * Layout strategy: a fixed sidebar on large screens, a top bar everywhere, and
 * a bottom bar on small ones. The sidebar is `lg:` rather than `md:` because a
 * 13-item list at 768px leaves the content column too narrow to work in.
 *
 * Every interactive piece here is a client component, but the shell itself only
 * holds UI state - the palette, the mobile drawer and the quick-capture field -
 * so the page content beneath it can stay a server component.
 */

function Sidebar({
  name,
  email,
  onOpenPalette,
}: {
  name: string | null;
  email: string;
  onOpenPalette: () => void;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-surface lg:flex">
      <div className="flex h-14 items-center justify-between px-4">
        <Wordmark size={26} />
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onOpenPalette}
          className={cn(
            "flex w-full items-center gap-2 rounded-control border border-line bg-surface-2",
            "px-2.5 py-2 text-[13px] text-ink-subtle transition-colors",
            "hover:border-line-strong hover:text-ink-muted",
            "focus-visible:ring-2 focus-visible:ring-lime/30 focus-visible:outline-none",
          )}
        >
          <Command aria-hidden className="size-3.5" />
          <span className="flex-1 text-left">Jump to…</span>
          <kbd className="rounded-[5px] border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <SidebarNav />
      </div>

      <div className="border-t border-line p-3">
        <SidebarSettingsLink />
        <div className="mt-2 flex items-center gap-2 rounded-control px-2 py-1.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-ink-muted">
            {(name ?? email).slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
            {name ?? email}
          </span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

export function AppShell({
  name,
  email,
  children,
}: {
  name: string | null;
  email: string;
  children: React.ReactNode;
}) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [quickOpen, setQuickOpen] = React.useState(false);

  const closeDrawer = React.useCallback(() => setDrawerOpen(false), []);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const k = event.key.toLowerCase();
      if (k === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // Bare "c" captures, but never while typing - otherwise every "C" in a
      // task title or a note would open a dialog over the text you are in.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (k === "c" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setQuickOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="min-h-dvh">
      <Sidebar name={name} email={email} onOpenPalette={() => setPaletteOpen(true)} />

      {/* Top bar: the only persistent chrome on small screens. */}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md lg:pl-[248px]">
        <div className="flex h-14 items-center gap-2 px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label={drawerOpen ? "Close menu" : "Open menu"}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            {drawerOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </Button>

          {/* Symbol only on the narrowest screens; the wordmark returns at `sm`. */}
          <span className="lg:hidden">
            <Wordmark size={26} textClassName="hidden sm:inline" />
          </span>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setQuickOpen(true)}
              title="Quick capture (C)"
            >
              <Plus aria-hidden />
              <span className="hidden sm:inline">New</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="lg:hidden"
              aria-label="Open command palette"
              onClick={() => setPaletteOpen(true)}
            >
              <Command aria-hidden />
            </Button>
            <UserMenu name={name} email={email} />
          </div>
        </div>
      </header>

      {/* Mobile drawer reuses the sidebar navigation so the two cannot drift. */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent
          size="sm"
          hideClose
          className="top-3 bottom-3 left-3 max-h-none translate-x-0 translate-y-0 p-0"
        >
          <DialogTitle className="sr-only">Menu</DialogTitle>
          <DialogDescription className="sr-only">
            Navigate between sections of LIFEOS.
          </DialogDescription>
          <div className="overflow-y-auto p-4">
            <SidebarNav onNavigate={closeDrawer} />
            <div className="mt-6 border-t border-line pt-4">
              <SidebarSettingsLink onNavigate={closeDrawer} />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      <QuickCapture open={quickOpen} onOpenChange={setQuickOpen} />

      <main className="px-4 pb-24 pt-6 lg:pb-10 lg:pl-[280px] lg:pr-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>

      <MobileNav />
      <InstallPrompt />
    </div>
  );
}
