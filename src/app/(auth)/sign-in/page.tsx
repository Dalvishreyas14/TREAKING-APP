import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignInForm } from "@/components/auth/sign-in-form";
import { googleAuthEnabled } from "@/lib/env";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your LIFEOS account.",
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  // Read on the server so the Google button is only rendered when the
  // credential actually exists. A public env flag could drift out of sync with
  // the real config and offer a button that always fails.
  const googleEnabled = googleAuthEnabled();

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to pick up where you left off."
      footer={
        <>
          New here?{" "}
          <Link href="/sign-up" className="font-medium text-lime hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      {/* useSearchParams requires a Suspense boundary during prerender. */}
      <Suspense fallback={<div className="h-64" />}>
        <SignInForm googleEnabled={googleEnabled} />
      </Suspense>
    </AuthShell>
  );
}
