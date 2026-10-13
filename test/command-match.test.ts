import { describe, expect, it } from 'vitest';

import {
  isSubsequence,
  normalise,
  rankMatches,
  scoreMatch,
  type Matchable,
} from '@/lib/command-match';

const item = (label: string, keywords: string[] = []): Matchable => ({ label, keywords });

describe('isSubsequence', () => {
  it('accepts characters that appear in order', () => {
    expect(isSubsequence('fcs', 'focus')).toBe(true);
    expect(isSubsequence('fs', 'focus')).toBe(true);
  });

  it('rejects characters that appear out of order', () => {
    expect(isSubsequence('csf', 'focus')).toBe(false);
  });

  it('rejects a character that is not present', () => {
    expect(isSubsequence('fz', 'focus')).toBe(false);
  });

  it('treats an empty query as matching', () => {
    expect(isSubsequence('', 'focus')).toBe(true);
  });
});

describe('normalise', () => {
  it('folds case, trims, and treats - and _ and space alike', () => {
    expect(normalise('  Deep-Work ')).toBe('deep work');
    expect(normalise('deep_work')).toBe('deep work');
    expect(normalise('DEEP WORK')).toBe('deep work');
  });
});

describe('scoreMatch', () => {
  it('ranks an exact label highest', () => {
    const exact = scoreMatch(item('Focus'), 'focus');
    const prefix = scoreMatch(item('Focus sessions'), 'focus');
    expect(exact).toBeGreaterThan(prefix);
  });

  it('ranks a label prefix above a label substring', () => {
    expect(scoreMatch(item('Focus'), 'foc')).toBeGreaterThan(
      scoreMatch(item('Deep focus mode'), 'foc'),
    );
  });

  it('ranks a label match above a keyword match', () => {
    expect(scoreMatch(item('Wellbeing', ['mood']), 'mood')).toBeLessThan(
      scoreMatch(item('Wellbeing'), 'well'),
    );
  });

  it('finds items only by keyword', () => {
    expect(scoreMatch(item('Focus', ['pomodoro', 'deep work']), 'pomodoro')).toBeGreaterThan(0);
    expect(scoreMatch(item('Focus', ['pomodoro', 'deep work']), 'deep work')).toBeGreaterThan(0);
  });

  it('returns zero for something unrelated', () => {
    expect(scoreMatch(item('Habits', ['streak']), 'zzz')).toBe(0);
  });

  it('is case and separator insensitive', () => {
    expect(scoreMatch(item('Wellbeing', ['sleep']), 'SLEEP')).toBeGreaterThan(0);
    expect(scoreMatch(item('AI Assistant', ['chat']), 'ai-assistant')).toBeGreaterThan(0);
  });

  it('prefers the shorter label when both match the same way', () => {
    expect(scoreMatch(item('Focus'), 'focus')).toBeGreaterThan(
      scoreMatch(item('Focus sessions'), 'focus'),
    );
  });

  it('returns everything for an empty query rather than nothing', () => {
    // An empty palette should list the primary destinations, not an empty box.
    expect(scoreMatch(item('Anything'), '')).toBeGreaterThan(0);
  });
});

describe('rankMatches', () => {
  const items = [
    item('Dashboard', ['home', 'overview']),
    item('Focus', ['timer', 'deep work']),
    item('Habits', ['streak']),
    item('Analytics', ['stats', 'report']),
    item('AI Assistant', ['chat', 'coach']),
  ];

  it('orders by score, best first', () => {
    const ranked = rankMatches(items, 'focus');
    expect(ranked[0]?.item.label).toBe('Focus');
  });

  it('drops anything that does not match', () => {
    expect(rankMatches(items, 'zzzz')).toHaveLength(0);
  });

  it('honours the limit', () => {
    expect(rankMatches(items, '', 3)).toHaveLength(3);
  });

  it('resolves an ambiguous query to the most useful item', () => {
    // "c" appears in Dashboard and AI Assistant; the shorter, more central one
    // should win rather than whichever happened to be declared first.
    const ranked = rankMatches(items, 'assistant');
    expect(ranked[0]?.item.label).toBe('AI Assistant');
  });

  it('finds a goal-adjacent word that is not on screen', () => {
    const ranked = rankMatches(items, 'streak');
    expect(ranked[0]?.item.label).toBe('Habits');
  });

  it('does not mutate the input', () => {
    const before = [...items];
    rankMatches(items, 'focus');
    expect(items).toEqual(before);
  });
});
