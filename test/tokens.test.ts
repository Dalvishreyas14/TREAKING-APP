import { describe, expect, it } from 'vitest';

import {
  createToken,
  hashToken,
  isExpired,
  normalizeEmail,
  resetExpiry,
  tokensMatch,
  verificationExpiry,
} from '@/lib/auth/tokens';

describe('opaque tokens', () => {
  it('never stores the raw token: only the digest round-trips', () => {
    const raw = createToken();
    const digest = hashToken(raw);

    expect(raw).not.toBe(digest);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(raw);
  });

  it('produces a different token each time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createToken()));
    expect(tokens.size).toBe(50);
  });

  it('generates url-safe tokens with no padding', () => {
    expect(createToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('matches the correct token and rejects everything else', () => {
    const raw = createToken();
    const digest = hashToken(raw);

    expect(tokensMatch(raw, digest)).toBe(true);
    expect(tokensMatch(createToken(), digest)).toBe(false);
    expect(tokensMatch(raw + 'x', digest)).toBe(false);
    expect(tokensMatch('', digest)).toBe(false);
  });

  it('rejects a stored value of the wrong length without throwing', () => {
    // A truncated or legacy-format hash must read as "no match" rather than
    // tripping the constant-time comparison on mismatched buffer sizes.
    const digest = hashToken(createToken());
    expect(tokensMatch('anything', digest.slice(0, 10))).toBe(false);
    expect(tokensMatch('anything', '')).toBe(false);
  });

  it('is deterministic for a given token', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });
});

describe('token expiry', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('gives verification links 24 hours', () => {
    const expiry = verificationExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('gives reset links 30 minutes', () => {
    const expiry = resetExpiry(now);
    expect(expiry.getTime() - now.getTime()).toBe(30 * 60 * 1000);
  });

  it('treats the expiry instant itself as expired', () => {
    const expiry = new Date(now.getTime() + 1000);
    expect(isExpired(expiry, new Date(now.getTime() + 999))).toBe(false);
    expect(isExpired(expiry, new Date(now.getTime() + 1000))).toBe(true);
    expect(isExpired(expiry, new Date(now.getTime() + 1001))).toBe(true);
  });
});

describe('email normalisation', () => {
  it('lowercases and trims so lookups are case-insensitive', () => {
    expect(normalizeEmail('  Demo@LifeOS.App ')).toBe('demo@lifeos.app');
  });

  it('is idempotent', () => {
    const once = normalizeEmail('USER@Example.COM');
    expect(normalizeEmail(once)).toBe(once);
  });
});
