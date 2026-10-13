import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo, WordmarkText } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

/**
 * The app's entry point.
 *
 * The phone app opens this route instead of the marketing homepage, so the very
 * first choice is "log in or sign up" rather than a marketing pitch. The brand
 * mark and wordmark are drawn here as the splash overlay clears, so the two
 * read as one continuous gesture.
 *
 * Deliberately no link back to `/`: inside the app the marketing page should
 * not be reachable, and a tappable wordmark pointing at it would be exactly the
 * affordance that leads there. Someone with a session skips straight to the app.
 */
export const metadata: Metadata = {
  title: "Welcome",
  description: "Sign in or create your LIFEOS account.",
  robots: { index: false, follow: false },
};

export default async function WelcomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="relative flex min-h-dvh flex-col justify-center overflow-hidden bg-canvas">
      <div
        aria-hidden
        className="aurora pointer-events-none fixed inset-x-0 top-0 h-80"
      />

      <main
        id="main"
        className="relative mx-auto flex w-full max-w-sm flex-col items-center px-6"
      >
        <Logo size={96} />
        <WordmarkText className="mt-6 text-2xl" />

        <p className="mt-4 text-center text-[14px] leading-relaxed text-ink-muted">
          One workspace for your tasks, habits, focus and goals.
        </p>

        <div className="mt-10 flex w-full flex-col gap-3">
          <Button variant="lime" size="lg" full asChild>
            <Link href="/sign-in">Log in</Link>
          </Button>
          <Button variant="secondary" size="lg" full asChild>
            <Link href="/sign-up">Sign up</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
