"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/auth/field";
import { api, ApiClientError } from "@/lib/api/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [pending, setPending] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [devUrl, setDevUrl] = React.useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending(true);

    try {
      const data = await api.post<{ sent: boolean; devResetUrl?: string }>(
        "/api/v1/auth/forgot-password",
        { email },
      );
      setDevUrl(data.devResetUrl);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? (err.fieldErrors.email ?? err.message)
          : "Something went wrong. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          If an account exists for <span className="text-ink">{email}</span>, a reset
          link is on its way. It expires in 30 minutes and can be used once.
        </p>

        {devUrl ? (
          <div className="rounded-control border border-lime/25 bg-lime-soft px-3 py-3">
            <p className="text-xs font-medium text-lime">Development mail transport</p>
            <Link
              href={devUrl}
              className="mt-2 inline-block text-[13px] font-medium text-lime underline underline-offset-4"
            >
              Open the reset link
            </Link>
          </div>
        ) : null}

        <Button asChild variant="secondary" className="w-full">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    // `method="post"` guards the pre-hydration submit: without it a submit that
    // lands before React attaches would GET, putting the address in the URL.
    <form
      onSubmit={onSubmit}
      method="post"
      className="flex flex-col gap-4"
      noValidate
    >
      <Field
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={error}
        placeholder="you@example.com"
      />

      <Button type="submit" loading={pending} disabled={pending} className="w-full">
        Send reset link
      </Button>
    </form>
  );
}
