import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Start tracking your life with LIFEOS.",
  robots: { index: false, follow: false },
};

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      description="A calmer way to see your days, weeks and goals in one place."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-lime hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
