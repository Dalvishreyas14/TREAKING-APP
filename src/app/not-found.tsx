import { ArrowLeft, Compass, LayoutDashboard, LogIn } from "lucide-react";

import { Wordmark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/guards";

/**
 * The 404 page.
 *
 * Worth having its own because the navigation is deliberately populated before
 * every destination is finished: until a screen lands, its link is the most
 * likely way to arrive here. So rather than apologising, this offers the two
 * places that are always useful and, when signed in, sends the visitor back to
 * where they were working.
 */
export default async function NotFound() {
  const user = await getCurrentUser();

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center px-5">
          <a href={user ? "/dashboard" : "/"} aria-label="LIFEOS home">
            <Wordmark />
          </a>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-5 py-20">
        <div className="w-full max-w-md text-center">
          <p className="font-mono text-[13px] tracking-[0.14em] text-ink-subtle">
            404
          </p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.025em]">
            This part isn&apos;t built yet
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
            The page you asked for doesn&apos;t exist. It may still be on the way —
            the rest of LIFEOS works, and your data is exactly where you left it.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {user ? (
              <Button variant="lime" asChild>
                <a href="/dashboard">
                  <LayoutDashboard aria-hidden />
                  Back to dashboard
                </a>
              </Button>
            ) : (
              <Button variant="lime" asChild>
                <a href="/sign-in">
                  <LogIn aria-hidden />
                  Sign in
                </a>
              </Button>
            )}
            <Button variant="secondary" asChild>
              <a href={user ? "/dashboard" : "/"}>
                {user ? (
                  <ArrowLeft aria-hidden />
                ) : (
                  <Compass aria-hidden />
                )}
                {user ? "Keep working" : "Back to home"}
              </a>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
