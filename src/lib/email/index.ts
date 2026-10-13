import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { devMailEnabled, env } from "@/lib/env";

/**
 * Email transport abstraction.
 *
 * Two implementations behind one interface so verification and reset flows are
 * fully testable on a laptop with no SMTP account, while production simply
 * switches transports. The active transport is chosen by EMAIL_TRANSPORT.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  readonly id: "dev" | "resend";
  send(message: EmailMessage): Promise<void>;
}

const BRAND = "LIFEOS";

function layout(heading: string, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<a href="${cta.url}" style="display:inline-block;background:#5c8a00;color:#fff;
         text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;
         font-size:15px;margin:22px 0 6px">${cta.label}</a>`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f7f7f4;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#0e1014">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px">
    <div style="font-weight:700;letter-spacing:-0.02em;font-size:18px;margin-bottom:28px">${BRAND}</div>
    <div style="background:#fff;border:1px solid rgba(10,11,15,.09);border-radius:16px;padding:32px">
      <h1 style="font-size:20px;margin:0 0 12px;letter-spacing:-0.02em">${heading}</h1>
      <div style="font-size:15px;line-height:1.65;color:#565e6b">${body}</div>
      ${button}
      <p style="font-size:12px;line-height:1.6;color:#8a929f;margin:24px 0 0;border-top:1px solid rgba(10,11,15,.09);padding-top:16px">
        If the button does not work, copy this link into your browser:<br>
        ${cta ? `<span style="word-break:break-all">${cta.url}</span>` : ""}
      </p>
    </div>
    <p style="font-size:11px;color:#8a929f;margin-top:20px;text-align:center">
      You are receiving this because someone used this address to create a ${BRAND} account.
    </p>
  </div></body></html>`;
}

/**
 * Development transport: writes each message to ./.dev-mail/ and logs the action
 * link. This is what makes the verification and reset journeys clickable in
 * local development without any third-party account.
 */
class DevTransport implements EmailTransport {
  readonly id = "dev" as const;

  async send(message: EmailMessage) {
    // Persisting the mailbox is best-effort: serverless hosts such as Vercel
    // expose a read-only filesystem, where mkdir/writeFile throw. The action
    // link is still logged and returned to the caller, so the verification and
    // reset journeys stay completable even when the file cannot be written.
    try {
      const dir = path.join(process.cwd(), ".dev-mail");
      await mkdir(dir, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, "_");
      await writeFile(
        path.join(dir, `${stamp}__${safeTo}.txt`),
        [
          `To: ${message.to}`,
          `Subject: ${message.subject}`,
          "",
          message.text,
          message.html ? `\n--- HTML ---\n${message.html}` : "",
        ].join("\n"),
        "utf8",
      );
    } catch (error) {
      console.warn(
        `[lifeos:email] could not persist dev mail to disk: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // The action link is the whole point of the dev transport.
    const link = message.text.match(/https?:\/\/\S+/)?.[0];
    console.info(
      `\n[lifeos:email] ${message.subject} -> ${message.to}` +
        (link ? `\n[lifeos:email] action link: ${link}\n` : "\n"),
    );
  }
}

class ResendTransport implements EmailTransport {
  readonly id = "resend" as const;

  async send(message: EmailMessage) {
    const { Resend } = await import("resend");
    const e = env();

    if (!e.RESEND_API_KEY) {
      throw new Error("EMAIL_TRANSPORT=resend requires RESEND_API_KEY");
    }

    const resend = new Resend(e.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: e.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    if (error) {
      throw new Error(`Email delivery failed: ${error.message}`);
    }
  }
}

let transport: EmailTransport | undefined;

export function emailTransport(): EmailTransport {
  transport ??=
    env().EMAIL_TRANSPORT === "resend" ? new ResendTransport() : new DevTransport();
  return transport;
}

function appUrl(): string {
  return env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
}

/** Absolute link that confirms an email address. Single source of truth. */
export function verificationUrl(token: string): string {
  return `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}

/** Absolute link that starts a password reset. Single source of truth. */
export function resetUrl(token: string): string {
  return `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * The action link, returned to the caller only when mail is being captured to
 * disk. This is what makes verification and reset completable during local
 * development without an SMTP account. Never returns a link when
 * EMAIL_TRANSPORT is a real provider.
 */
export function devActionUrl(url: string): string | undefined {
  return devMailEnabled() ? url : undefined;
}

export async function sendVerificationEmail(to: string, token: string) {
  const url = verificationUrl(token);
  const body = `Welcome to ${BRAND}. Confirm your email address to activate your account.`;
  await emailTransport().send({
    to,
    subject: `Verify your ${BRAND} email`,
    text: `${body}\n\n${url}\n\nThis link expires in 24 hours.`,
    html: layout("Confirm your email", `${body}<br><br>This link expires in 24 hours.`, {
      label: "Verify email",
      url,
    }),
  });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const url = resetUrl(token);
  const body = `We received a request to reset your ${BRAND} password. Choose a new one using the link below.`;
  await emailTransport().send({
    to,
    subject: `Reset your ${BRAND} password`,
    text: `${body}\n\n${url}\n\nThis link expires in 30 minutes and can be used once. If you did not request this, you can ignore this email.`,
    html: layout(
      "Reset your password",
      `${body}<br><br>This link expires in 30 minutes and can be used once. If you did not request a password reset, you can safely ignore this email.`,
      { label: "Choose a new password", url },
    ),
  });
}
