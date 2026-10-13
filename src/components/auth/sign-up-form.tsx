"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/auth/field";
import { PasswordRules } from "@/components/auth/password-rules";
import { api, ApiClientError } from "@/lib/api/client";
import { PASSWORD_RULES } from "@/lib/auth/password-policy";

interface SignUpResult {
  email: string;
  devVerificationUrl?: string;
}

export function SignUpForm() {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<SignUpResult | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setPending(true);

    try {
      const data = await api.post<SignUpResult>("/api/v1/auth/sign-up", {
        name,
        email,
        password,
      });
      setResult(data);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors({ ...error.fieldErrors, form: error.fieldErrors.form ?? error.message });
      } else {
        setErrors({ form: "Something went wrong. Please try again." });
      }
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return <SignUpConfirmation email={result.email} devUrl={result.devVerificationUrl} />;
  }

  const unmet = PASSWORD_RULES.filter((r) => !r.test(password));

  return (
    // `method="post"` guards the pre-hydration submit: without it a submit that
    // lands before React attaches would GET, putting the password in the URL.
    <form
      onSubmit={onSubmit}
      method="post"
      className="flex flex-col gap-4"
      noValidate
    >
      <Field
        label="Name"
        name="name"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        placeholder="How should we address you?"
      />

      <Field
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        placeholder="you@example.com"
      />

      <div className="flex flex-col gap-1.5">
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="Choose something you will remember."
        />
        <PasswordRules rules={unmet.map((r) => r.label)} />
      </div>

      {errors.form ? (
        <p
          role="alert"
          className="rounded-control border border-negative/30 bg-negative/8 px-3 py-2.5 text-[13px] leading-relaxed text-negative"
        >
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" loading={pending} disabled={pending} className="w-full">
        Create account
      </Button>

      <p className="text-xs leading-relaxed text-ink-subtle">
        LIFEOS keeps your data private to your account. We never sell it, and you
        can export or delete everything at any time.
      </p>
    </form>
  );
}

function SignUpConfirmation({
  email,
  devUrl,
}: {
  email: string;
  devUrl?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm leading-relaxed text-ink-muted">
          We sent a verification link to <span className="text-ink">{email}</span>.
          Confirm your address to activate your account.
        </p>
        <p className="text-[13px] leading-relaxed text-ink-subtle">
          The link expires in 24 hours. Nothing else is required before you sign in.
        </p>
      </div>

      {devUrl ? (
        <div className="rounded-control border border-lime/25 bg-lime-soft px-3 py-3">
          <p className="text-xs font-medium text-lime">Development mail transport</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Mail is being written to disk rather than delivered, so here is your link.
          </p>
          <Link
            href={devUrl}
            className="mt-2 inline-block text-[13px] font-medium text-lime underline underline-offset-4"
          >
            Verify email address
          </Link>
        </div>
      ) : null}

      <Button asChild variant="secondary" className="w-full">
        <Link href="/sign-in">Go to sign in</Link>
      </Button>
    </div>
  );
}
