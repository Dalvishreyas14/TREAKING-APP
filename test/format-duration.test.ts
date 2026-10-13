import { describe, expect, it } from 'vitest';

import { formatFocusSeconds } from '@/lib/format/duration';

describe('formatFocusSeconds', () => {
  it('reports sub-minute focus as less than a minute, not as zero', () => {
    // 20 seconds of focus happened. Rendering "0m" makes it indistinguishable
    // from a task nobody ever started, which is the exact confusion this
    // function exists to avoid.
    expect(formatFocusSeconds(20)).toBe('<1m');
    expect(formatFocusSeconds(59)).toBe('<1m');
  });

  it('reports whole minutes below an hour', () => {
    expect(formatFocusSeconds(60)).toBe('1m');
    expect(formatFocusSeconds(25 * 60)).toBe('25m');
    expect(formatFocusSeconds(59 * 60)).toBe('59m');
  });

  it('switches to hours and keeps the remainder', () => {
    expect(formatFocusSeconds(60 * 60)).toBe('1h');
    expect(formatFocusSeconds(90 * 60)).toBe('1h 30m');
    expect(formatFocusSeconds(3600 * 60)).toBe('60h');
  });

  it('treats absent or nonsensical focus as zero rather than NaN', () => {
    expect(formatFocusSeconds(0)).toBe('0m');
    expect(formatFocusSeconds(-60)).toBe('0m');
    expect(formatFocusSeconds(Number.NaN)).toBe('0m');
    expect(formatFocusSeconds(Number.POSITIVE_INFINITY)).toBe('0m');
  });
});
