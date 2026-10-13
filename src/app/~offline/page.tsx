import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

/**
 * The offline fallback.
 *
 * The service worker serves this for a document request that cannot reach the
 * network and is not already in the cache. It is a full page on purpose: an
 * installed app that shows a browser error screen stops feeling installed. The
 * "Try again" link re-requests the current page, so a user whose signal came
 * back is one tap from where they were.
 */
export default function OfflinePage() {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-6">
      <div
        aria-hidden
        className="bloom-lime pointer-events-none absolute inset-x-0 top-0 h-72"
      />

      <div className="relative flex max-w-sm flex-col items-center text-center">
        <div className="grid size-14 place-items-center rounded-card border border-line bg-surface-2 text-lime">
          <WifiOff aria-hidden className="size-6" />
        </div>

        <h1 className="mt-6 text-xl font-semibold tracking-[-0.02em] text-ink">
          You are offline
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
          LIFEOS needs a connection to sync your data. Your logged work is safe —
          reconnect and it will be here.
        </p>

        <Button asChild variant="lime" className="mt-7">
          <Link href="/">Try again</Link>
        </Button>

        <div className="mt-10 opacity-70">
          <Wordmark size={22} />
        </div>
      </div>
    </main>
  );
}
