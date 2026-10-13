import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Opaque, single-use tokens for email verification and password reset.
 *
 * The raw token is emailed to the user and never stored. Only its SHA-256
 * digest goes in the database, so a database leak does not hand an attacker a
 * working reset link. Comparison is constant-time.
 */

const VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const RESET_TTL_MS = 1000 * 60 * 30; // 30 minutes

export function createToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokensMatch(raw: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(raw), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verificationExpiry(now = new Date()): Date {
  return new Date(now.getTime() + VERIFICATION_TTL_MS);
}

export function resetExpiry(now = new Date()): Date {
  return new Date(now.getTime() + RESET_TTL_MS);
}

export function isExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/** Normalises an emailed address so lookup is case-insensitive. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
