import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  validatePassword,
} from '@/lib/auth/password-policy';

describe('password policy', () => {
  it('accepts a password that satisfies every rule', () => {
    expect(validatePassword('Tr0ub4dor&3')).toEqual([]);
  });

  it('reports every unmet rule rather than only the first', () => {
    // Lowercase only: fails length, uppercase and digit.
    const problems = validatePassword('abc');
    expect(problems).toHaveLength(3);
    expect(problems).toContain('At least 10 characters');
    expect(problems).toContain('An uppercase letter');
    expect(problems).toContain('A number');
  });

  it('treats the minimum length as inclusive', () => {
    const exactly10 = 'Aa1' + 'x'.repeat(PASSWORD_MIN_LENGTH - 3);
    expect(exactly10).toHaveLength(PASSWORD_MIN_LENGTH);
    expect(validatePassword(exactly10)).toEqual([]);

    const oneShort = 'Aa1' + 'x'.repeat(PASSWORD_MIN_LENGTH - 4);
    expect(validatePassword(oneShort)).toContain('At least 10 characters');
  });

  it('does not require a symbol, because no rule asks for one', () => {
    expect(validatePassword('Abcdefghij1')).toEqual([]);
  });

  it('exposes a stable, ordered rule list the client renders', () => {
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual([
      'length',
      'upper',
      'lower',
      'digit',
    ]);
    for (const rule of PASSWORD_RULES) {
      expect(rule.test('Aa1bbbbbbbb')).toBe(true);
    }
  });
});
