import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('produces a verifiable argon2id hash', async () => {
    const hash = await hashPassword('Tr0ub4dor&3');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'Tr0ub4dor&3')).resolves.toBe(true);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('Tr0ub4dor&3');
    const b = await hashPassword('Tr0ub4dor&3');
    expect(a).not.toBe(b);
    // Both still verify, which is the only property that matters.
    await expect(verifyPassword(a, 'Tr0ub4dor&3')).resolves.toBe(true);
    await expect(verifyPassword(b, 'Tr0ub4dor&3')).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('Tr0ub4dor&3');
    await expect(verifyPassword(hash, 'Tr0ub4dor&4')).resolves.toBe(false);
    await expect(verifyPassword(hash, '')).resolves.toBe(false);
  });

  it('reads a malformed hash as invalid credentials rather than throwing', async () => {
    // The credentials provider runs a verification even for an unknown email, so
    // a bad stored value must not throw: an exception would distinguish "no such
    // user" from "wrong password" and reintroduce the timing signal the dummy
    // hash exists to remove.
    for (const bad of [
      '',
      'not-a-hash',
      '$argon2id$v=19$m=19456,t=2,p=1$missing',
      '$argon2id$v=19$m=19456,t=2,p=1$JlFzgbelOwUYU8EOVpBD0w$',
      '$argon2i$v=19$m=19456,t=2,p=1$JlFzgbelOwUYU8EOVpBD0w$Q2joMWISS8PMRVqDscxYdFs1tbLtxhQmK/obEpnXhMw',
    ]) {
      await expect(verifyPassword(bad, 'Tr0ub4dor&3'), bad).resolves.toBe(false);
    }
  });

  it('verifies the dummy hash used for unknown emails, so timing matches', async () => {
    // Copied from the credentials provider. If this stops verifying, the
    // "unknown email" path gets fast again and leaks account existence.
    const DUMMY_HASH =
      '$argon2id$v=19$m=19456,t=2,p=1$JlFzgbelOwUYU8EOVpBD0w$Q2joMWISS8PMRVqDscxYdFs1tbLtxhQmK/obEpnXhMw';
    await expect(verifyPassword(DUMMY_HASH, 'anything at all')).resolves.toBe(false);
  });

  it('handles a long unicode password without truncating', async () => {
    const long = 'Aa1' + '\u00e9\u4e2d\ud83d\ude00'.repeat(40);
    const hash = await hashPassword(long);
    await expect(verifyPassword(hash, long)).resolves.toBe(true);
    await expect(verifyPassword(hash, long + 'x')).resolves.toBe(false);
  });
});
