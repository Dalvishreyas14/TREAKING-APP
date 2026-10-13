import { describe, expect, it } from 'vitest';

import { parseTaskText } from '@/lib/ai/task-parser';

const NOW = new Date(2026, 2, 11, 10, 0, 0); // Wednesday 11 March 2026, 10:00

describe('parseTaskText', () => {
  it('keeps a plain sentence as the title and defaults everything else', () => {
    const parsed = parseTaskText('buy milk', NOW);
    expect(parsed.title).toBe('Buy milk');
    expect(parsed.dueAt).toBeNull();
    expect(parsed.estimatedMinutes).toBeNull();
    expect(parsed.priority).toBe('MEDIUM');
    expect(parsed.confidence).toBe(0);
  });

  it('separates the title from the deadline', () => {
    const parsed = parseTaskText('draft the proposal friday at 4pm', NOW);
    expect(parsed.title).toBe('Draft the proposal');
    expect(parsed.dueAt).not.toBeNull();
    expect(parsed.dueAt!.getDay()).toBe(5); // Friday
    expect(parsed.dueAt!.getHours()).toBe(16);
  });

  it('reads an effort estimate out of the sentence', () => {
    const parsed = parseTaskText('review chapter 4 for 45m', NOW);
    expect(parsed.estimatedMinutes).toBe(45);
    expect(parsed.title).toContain('chapter 4');
  });

  it('reads an explicit priority keyword', () => {
    const parsed = parseTaskText('urgent: renew the passport', NOW);
    expect(parsed.priority).toBe('URGENT');
    expect(parsed.importance).toBe(5);
    expect(parsed.urgency).toBe(5);
  });

  it('raises a task with a near deadline to high priority', () => {
    const parsed = parseTaskText('file the tax return tomorrow', NOW);
    expect(parsed.priority).toBe('HIGH');
    expect(parsed.reasons.join(' ')).toMatch(/raised to high/i);
  });

  it('flags recurrence without inventing a schedule', () => {
    const parsed = parseTaskText('water the plants every day', NOW);
    expect(parsed.isRecurring).toBe(true);
    expect(parsed.reasons.join(' ')).toMatch(/repeating pattern/i);
  });

  it('classifies effort cost from the verb', () => {
    expect(parseTaskText('quick reply to Priya', NOW).energy).toBe('LOW');
    expect(parseTaskText('deep work on the architecture doc', NOW).energy).toBe('HIGH');
  });

  it('always explains itself, and never claims more than it understood', () => {
    const parsed = parseTaskText('call the clinic tomorrow at 9am', NOW);
    expect(parsed.reasons.length).toBeGreaterThan(0);
    expect(parsed.confidence).toBeGreaterThan(0);
    expect(parsed.confidence).toBeLessThanOrEqual(1);
  });

  it('falls back to the original text when cleanup would leave nothing', () => {
    const parsed = parseTaskText('tomorrow', NOW);
    expect(parsed.title.length).toBeGreaterThan(0);
  });

  it('leaves unrelated words in the title rather than dropping them', () => {
    const parsed = parseTaskText('email Sam about the q3 budget tomorrow', NOW);
    expect(parsed.title).toMatch(/Sam/);
    expect(parsed.title).toMatch(/budget/);
    expect(parsed.title).not.toMatch(/tomorrow/i);
  });
});
