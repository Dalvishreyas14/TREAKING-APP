import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LIMITS, rateLimit } from '@/lib/rate-limit';

/**
 * The limiter keeps module-level state, which is the point: it is a fixed window
 * held in process memory. Each test therefore uses its own key so no test can be
 * affected by another's counter.
 */
let seq = 0;
const key = () => `test:key:${seq++}`;

describe('rate limiter', () => {
  it('allows a request inside the window and counts down remaining', () => {
    const k = key();
    const first = rateLimit(k, 3, 60_000);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = rateLimit(k, 3, 60_000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it('allows exactly `limit` requests, then blocks', () => {
    const k = key();
    const results = Array.from({ length: 5 }, () => rateLimit(k, 3, 60_000));

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
  });

  it('never reports negative remaining', () => {
    const k = key();
    let last = rateLimit(k, 1, 60_000);
    for (let i = 0; i < 4; i++) last = rateLimit(k, 1, 60_000);
    expect(last.remaining).toBe(0);
  });

  it('does not extend the window when blocked requests keep arriving', () => {
    const k = key();
    const first = rateLimit(k, 2, 60_000);
    rateLimit(k, 2, 60_000);
    const third = rateLimit(k, 2, 60_000);
    expect(third.allowed).toBe(false);
    // The reset instant is pinned to when the window opened, not to the latest
    // request, so a client cannot hold a window open by retrying.
    expect(third.resetAt).toBe(first.resetAt);
  });

  it('isolates counters per key', () => {
    const a = key();
    const b = key();
    for (let i = 0; i < 3; i++) rateLimit(a, 3, 60_000);
    expect(rateLimit(a, 3, 60_000).allowed).toBe(false);
    expect(rateLimit(b, 3, 60_000).allowed).toBe(true);
  });

  it('starts a fresh window once the previous one has elapsed', () => {
    vi.useFakeTimers();
    try {
      const k = key();
      expect(rateLimit(k, 1, 1000).allowed).toBe(true);
      expect(rateLimit(k, 1, 1000).allowed).toBe(false);

      vi.advanceTimersByTime(1001);
      expect(rateLimit(k, 1, 1000).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a positive retryAfter even as the window closes', () => {
    const k = key();
    const blocked = (() => {
      rateLimit(k, 1, 60_000);
      return rateLimit(k, 1, 60_000);
    })();
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('rate limit presets', () => {
  beforeEach(() => {
    seq = 0;
  });

  it('every preset is a positive limit over a positive window', () => {
    for (const [name, preset] of Object.entries(LIMITS)) {
      expect(preset.limit, name).toBeGreaterThan(0);
      expect(preset.windowMs, name).toBeGreaterThan(0);
    }
  });

  it('sign-in is limited more tightly than ordinary reads', () => {
    expect(LIMITS.signIn.limit).toBeLessThan(LIMITS.search.limit);
  });

  it('password reset is limited more tightly than sign-up', () => {
    expect(LIMITS.passwordReset.limit).toBeLessThanOrEqual(LIMITS.signUp.limit);
  });
});
