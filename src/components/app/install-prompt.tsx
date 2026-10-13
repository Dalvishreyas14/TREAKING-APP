"use client";

import * as React from "react";
import { Download, Share, X } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The "install LIFEOS" affordance.
 *
 * Android/Chrome fire `beforeinstallprompt`, which we hold onto and replay when
 * the user taps Install. iOS never fires that event, so on an iPhone or iPad we
 * show the manual "Share → Add to Home Screen" path instead.
 *
 * Nothing renders until the client has mounted and confirmed the app is (a) not
 * already installed and (b) installable on this platform, so an installed app
 * and an unsupported browser both stay quiet. `useSyncExternalStore` is used as
 * a hydration-safe "is this the client?" switch, which keeps the server and the
 * first client render identical (both render nothing) without a state-setting
 * effect.
 */

interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt: () => Promise<void>;
}

const DISMISS_KEY = "lifeos:install-dismissed";

function detectPlatform(): "ios" | "other" | null {
  if (window.matchMedia("(display-mode: standalone)").matches) return null;
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone) {
    return null;
  }
  try {
    if (window.localStorage.getItem(DISMISS_KEY) === "1") return null;
  } catch {
    // Storage blocked in some private modes; treat as not-yet-dismissed.
  }
  const ua = window.navigator.userAgent;
  const ios =
    /iphone|ipad|ipod/i.test(ua) && !("MSStream" in (window as Window & { MSStream?: unknown }));
  return ios ? "ios" : "other";
}

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function InstallPrompt() {
  // True only after hydration on the client, without a setState-in-effect.
  const mounted = React.useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (!mounted) return;
    function onBeforeInstall(event: Event) {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, [mounted]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Non-fatal: the prompt simply returns next visit.
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === "accepted") dismiss();
  }

  const platform = mounted && !dismissed ? detectPlatform() : null;
  const visible =
    platform === "ios" || (platform === "other" && deferred !== null);
  if (!visible) return null;

  return (
    <aside
      aria-label="Install LIFEOS"
      className="glass fixed inset-x-3 bottom-20 z-40 flex items-start gap-3 rounded-card border border-line p-3.5 shadow-pop lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-80"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-control bg-lime-soft text-lime">
        <Download aria-hidden className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink">Install LIFEOS</p>

        {platform === "ios" ? (
          <>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
              Add it to your home screen for a full-screen, app-like experience.
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] leading-relaxed text-ink-muted">
              Tap
              <Share aria-hidden className="size-3.5 text-lime" />
              Share, then
              <span className="font-medium text-ink">Add to Home Screen</span>.
            </p>
          </>
        ) : (
          <>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-muted">
              Faster launches and an app icon, right on your home screen.
            </p>
            <Button size="sm" variant="lime" className="mt-2.5" onClick={install}>
              Install
            </Button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="-m-1 shrink-0 rounded-control p-1 text-ink-subtle transition-colors hover:text-ink"
      >
        <X aria-hidden className="size-4" />
      </button>
    </aside>
  );
}