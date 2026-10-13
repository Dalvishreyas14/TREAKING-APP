"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/auth/field";
import { SignInGoogle } from "@/components/auth/sign-in-google";

const CREDENTIALS_FAILURE =
  "That email and password did not work. If you have not verified your email yet, check your inbox for the link first.";

/**
 * Shown when the server answers 429. It is about this browser and network, not
 * about the account, so it says nothing about whether the address exists.
 */
const RATE_LIMITED = "Too many sign-in attempts. Wait a few minutes and try again.";

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, startTransition] = React.useTransition();

  // Only allow same-origin relative redirects, so a crafted ?callbackUrl cannot
  // bounce a freshly authenticated user to an attacker's page.
  const callbackUrl = React.useMemo(() => {
    const raw = params.get("callbackUrl");
    if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
    return raw;
  }, [params]);

  React.useEffect(() => {
    if (params.get("verified") === "1") {
      toast.success("Email verified. Sign in to continue.");
    }
    if (params.get("reset") === "1") {
      toast.success("Password updated. Sign in with your new password.");
    }
  }, [params]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    startTransition(async () => {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      // A throttled attempt comes back as a 429 with the app's own JSON envelope,
      // not as an Auth.js redirect, so it is identified by status rather than by
      // an error code. It says nothing about whether the account exists, because
      // the limit is reached by trying any address.
      if (result?.status === 429) {
        setErrors({ form: RATE_LIMITED });
        return;
      }

      if (result?.error || result?.ok === false) {
        // A single message for every credential failure. We must not reveal
        // whether the address exists, nor that it exists but is unverified.
        setErrors({ form: CREDENTIALS_FAILURE });
        return;
      }

      // On success the JWT cookie is set; a hard navigation lets the server
      // components and proxy see it immediately.
      router.push(callbackUrl);
      router.refresh();
    });
  }

  return (
    // `method="post"` is the guard against a pre-hydration submit. Without it the
    // browser falls back to a native GET and puts the password in the query
    // string, where it lands in server logs, browser history and the `Referer`
    // header of every subsequent request. `onSubmit` calls `preventDefault`, but
    // that handler does not exist yet during hydration, so the fallback is the
    // only thing standing between a slow first paint and a leaked password.
    <form
      onSubmit={onSubmit}
      method="post"
      className="flex flex-col gap-4"
      noValidate
    >
      {googleEnabled ? <SignInGoogle callbackUrl={callbackUrl} /> : null}

      {googleEnabled ? (
        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          <span className="text-xs text-ink-subtle">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>
      ) : null}

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

      <Field
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        trailing={
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-ink-muted transition-colors hover:text-lime"
          >
            Forgot
          </Link>
        }
      />

      {errors.form ? (
        <p
          role="alert"
          className="rounded-control border border-negative/30 bg-negative/8 px-3 py-2.5 text-[13px] leading-relaxed text-negative"
        >
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" loading={pending} disabled={pending} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
