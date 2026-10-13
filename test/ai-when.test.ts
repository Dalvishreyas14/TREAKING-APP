import { describe, expect, it } from 'vitest';

import { extractDuration, extractWhen, stripTemporal } from '@/lib/ai/when';
import { dateOnlyLocal } from '@/lib/date';

/**
 * A fixed reference instant so every expectation is a literal.
 *
 * Wednesday 2026-03-11, 10:00 local. Midweek on purpose: weekday-name
 * arithmetic is the part of this parser most likely to be off by one, and a
 * weekend fixture hides that entirely.
 */
const NOW = new Date(2026, 2, 11, 10, 0, 0);

function day(when: ReturnType<typeof extractWhen>) {
  if (!when.date) return null;
  const d = when.date;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

describe('extractWhen', () => {
  it('returns nothing rather than guessing on plain text', () => {
    const when = extractWhen('buy milk', NOW);
    expect(when.date).toBeNull();
    expect(when.minutes).toBeNull();
    expect(when.matched).toBeNull();
  });

  it('reads bare relative days', () => {
    expect(day(extractWhen('ship it tomorrow', NOW))).toBe('2026-03-12');
    expect(day(extractWhen('ship it today', NOW))).toBe('2026-03-11');
    expect(day(extractWhen('ship it day after tomorrow', NOW))).toBe('2026-03-13');
  });

  it('keeps `tonight` on today but gives it an evening time', () => {
    const when = extractWhen('call mum tonight', NOW);
    expect(day(when)).toBe('2026-03-11');
    expect(when.minutes).toBe(20 * 60);
    expect(when.allDay).toBe(false);
  });

  it('reads weekday names, including today and the wrap past Sunday', () => {
    // Today is Wednesday.
    expect(day(extractWhen('standup friday', NOW))).toBe('2026-03-13');
    expect(day(extractWhen('standup monday', NOW))).toBe('2026-03-16');
    expect(day(extractWhen('standup wednesday', NOW))).toBe('2026-03-11');
  });

  it('pushes `next <weekday>` a full week out when it is today', () => {
    expect(day(extractWhen('retro next wednesday', NOW))).toBe('2026-03-18');
  });

  it('reads clock times in 12- and 24-hour form', () => {
    expect(extractWhen('call at 9am', NOW).minutes).toBe(9 * 60);
    expect(extractWhen('call at 5pm', NOW).minutes).toBe(17 * 60);
    expect(extractWhen('call at 14:30', NOW).minutes).toBe(14 * 60 + 30);
    expect(extractWhen('call at 12am', NOW).minutes).toBe(0);
    expect(extractWhen('call at 12pm', NOW).minutes).toBe(12 * 60);
  });

  it('does not read a bare number as a clock time', () => {
    // The guard that keeps "finish 3 problems" from becoming a 3am deadline.
    const when = extractWhen('finish 3 problems', NOW);
    expect(when.minutes).toBeNull();
    expect(when.matched).toBeNull();
  });

  it('combines a named day with a named time', () => {
    const when = extractWhen('review friday at 4pm', NOW);
    expect(day(when)).toBe('2026-03-13');
    expect(when.minutes).toBe(16 * 60);
  });

  it('reads ISO and slashed dates', () => {
    expect(day(extractWhen('due 2026-04-01', NOW))).toBe('2026-04-01');
    // 25 cannot be a month, so ordering is unambiguous.
    expect(day(extractWhen('due 25/03', NOW))).toBe('2026-03-25');
  });

  it('reads month-name dates', () => {
    expect(day(extractWhen('due March 30', NOW))).toBe('2026-03-30');
  });

  it('reads relative offsets in both directions', () => {
    expect(day(extractWhen('due in 3 days', NOW))).toBe('2026-03-14');
    expect(extractWhen('remind me in 45 minutes', NOW).minutes).toBe(10 * 60 + 45);
  });

  it('only claims the first temporal phrase', () => {
    const when = extractWhen('call Sam tomorrow then book the dentist next week', NOW);
    expect(day(when)).toBe('2026-03-12');
  });

  it('round-trips the calendar day it names', () => {
    const when = extractWhen('thing tomorrow', NOW);
    expect(when.date!.getTime()).toBe(dateOnlyLocal(new Date(2026, 2, 12)).getTime());
  });
});

describe('extractDuration', () => {
  it('reads compact and spelled-out forms', () => {
    expect(extractDuration('read for 45m').minutes).toBe(45);
    expect(extractDuration('read for 1h').minutes).toBe(60);
    expect(extractDuration('read for 90 minutes').minutes).toBe(90);
    expect(extractDuration('read for half an hour').minutes).toBe(30);
  });

  it('returns null when there is no duration', () => {
    expect(extractDuration('write the summary').minutes).toBeNull();
  });
});

describe('stripTemporal', () => {
  it('removes only spans the parser actually claimed', () => {
    const text = 'Draft the proposal friday at 4pm for 30m';
    const when = extractWhen(text, NOW);
    const duration = extractDuration(text);
    const rest = stripTemporal(text, when, duration);
    expect(rest).not.toMatch(/friday/i);
    expect(rest).not.toMatch(/30m/);
    expect(rest).toMatch(/proposal/i);
  });

  it('leaves unclaimed text alone', () => {
    const when = extractWhen('buy milk', NOW);
    expect(stripTemporal('buy milk', when)).toBe('buy milk');
  });
});
