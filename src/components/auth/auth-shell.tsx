import Link from "next/link";
import type { ReactNode } from "react";

import { Wordmark } from "@/components/brand/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shared shell for every unauthenticated screen.
 *
 * Kept deliberately narrow: brand mark, one card, one action. The auth flows
 * are transient states, and giving them the full app chrome would imply they are
 * places the user can linger.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative min-h-dvh bg-canvas">
      {/* Ambient brand wash, a single quiet gesture behind the card. */}
      <div
        aria-hidden
        className="aurora pointer-events-none fixed inset-x-0 top-0 h-80"
      />

      <main id="main" className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-16">
        <Link
          href="/"
          aria-label="LIFEOS home"
          className="mb-8 flex items-center self-start rounded-lg text-ink transition-opacity hover:opacity-80"
        >
          <Wordmark size={32} />
        </Link>

        <Card className="gradient-border shadow-[0_1px_0_rgba(255,255,255,.04)_inset,0_20px_50px_-24px_rgba(0,0,0,.6)]">
          <CardHeader>
            <CardTitle className="text-xl tracking-[-0.02em]">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-5">{children}</CardContent>
        </Card>

        {footer ? <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div> : null}
      </main>
    </div>
  );
}
