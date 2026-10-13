import { Suspense } from "react";
import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  description: "Set a new password for your LIFEOS account.",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthShell
      title="Choose a new password"
      description="Pick something you will remember. We will sign out your other sessions."
    >
      <Suspense fallback={<div className="h-64" />}>
        <ResetPasswordForm token={token} />
      </Suspense>
    </AuthShell>
  );
}
