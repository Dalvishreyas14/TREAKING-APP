"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { api, ApiClientError } from "@/lib/api/client";

type State =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "verified" }
  | { kind: "error"; message: string };

function CheckCircleGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden focusable="false">
      <path
        d="M21 12a9 9 0 1 1-3.2-6.9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="m9 12 2.5 2.5L21 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Verification is a deliberate button press, never an automatic effect on load.
 *
 * An emailed URL is a GET, and GETs get crawled by link scanners and email
 * security products. Consuming a single-use token on load would mean the link
 * was dead before the user ever saw it.
 */
export function VerifyEmailCard({ token }: { token?: string }) {
  const [state, setState] = React.useState<State>({ kind: "idle" });

  async function verify() {
    if (!token) {
      setState({ kind: "error", message: "This verification link is not valid." });
      return;
    }
    setState({ kind: "pending" });
    try {
      await api.post("/api/v1/auth/verify-email", { token });
      setState({ kind: "verified" });
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof ApiClientError
            ? err.message
            : "We could not verify that link. Please try again.",
      });
    }
  }

  if (state.kind === "verified") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-lime-soft text-lime">
            <CheckCircleGlyph />
          </span>
          <p className="text-sm leading-relaxed text-ink-muted">
            Your email address is confirmed. Your account is ready.
          </p>
        </div>
        <Button asChild className="w-full">
          <Link href="/sign-in?verified=1">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-ink-muted">
        Confirm this email address to finish setting up your LIFEOS account.
      </p>

      {state.kind === "error" ? (
        <p
          role="alert"
          className="rounded-control border border-negative/30 bg-negative/8 px-3 py-2.5 text-[13px] leading-relaxed text-negative"
        >
          {state.message}
        </p>
      ) : null}

      <Button
        className="w-full"
        loading={state.kind === "pending"}
        disabled={state.kind === "pending"}
        onClick={verify}
      >
        Verify email address
      </Button>

      <Link
        href="/sign-in"
        className="self-center text-[13px] text-ink-muted transition-colors hover:text-lime"
      >
        Back to sign in
      </Link>
    </div>
  );
}
