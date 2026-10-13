"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/auth/field";
import { PasswordRules } from "@/components/auth/password-rules";
import { api, ApiClientError } from "@/lib/api/client";
import { PASSWORD_RULES } from "@/lib/auth/password-policy";

export function ResetPasswordForm({ token }: { token?: string }) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const unmet = PASSWORD_RULES.filter((r) => !r.test(password));
  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});

    if (mismatch) {
      setErrors({ confirm: "Those passwords do not match" });
      return;
    }
    if (!token) {
      setErrors({ form: "This reset link is not valid. Request a new one." });
      return;
    }

    setPending(true);
    try {
      await api.post("/api/v1/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrors({ ...err.fieldErrors, form: err.fieldErrors.form ?? err.message });
      } else {
        setErrors({ form: "Something went wrong. Please try again." });
      }
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-ink-muted">
          Your password has been updated and any other sessions were signed out.
        </p>
        <Button
          className="w-full"
          onClick={() => {
            router.push("/sign-in?reset=1");
            router.refresh();
          }}
        >
          Sign in
        </Button>
      </div>
    );
  }

  return (
    // `method="post"` guards the pre-hydration submit: without it a submit that
    // lands before React attaches would GET, putting the new password in the URL.
    <form
      onSubmit={onSubmit}
      method="post"
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <Field
          label="New password"
          type="password"
          name="new-password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <PasswordRules rules={unmet.map((r) => r.label)} />
      </div>

      <Field
        label="Confirm new password"
        type="password"
        name="confirm-password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={mismatch ? "Those passwords do not match" : errors.confirm}
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
        Update password
      </Button>

      <Link
        href="/forgot-password"
        className="self-center text-[13px] text-ink-muted transition-colors hover:text-lime"
      >
        Request a different link
      </Link>
    </form>
  );
}
