import { describe, expect, it } from 'vitest';

import { consumeSignInAttempt, isCredentialsSignIn } from '@/lib/auth/sign-in-limit';

let seq = 0;
const unique = (prefix: string) => `${prefix}-${seq++}`;

/** Builds a Request with a spoofable client address, as a proxy would set it. */
function request(path: string, ip?: string): Request {
  const headers = new Headers();
  if (ip) headers.set('x-forwarded-for', ip);
  return new Request(`https://lifeos.test${path}`, { headers });
}

const credentials = '/api/auth/callback/credentials';

describe('isCredentialsSignIn', () => {
  it('matches the credentials callback only', () => {
    expect(isCredentialsSignIn(request(credentials))).toBe(true);
    expect(isCredentialsSignIn(request('/api/auth/session'))).toBe(false);
    expect(isCredentialsSignIn(request('/api/auth/callback/google'))).toBe(false);
    expect(isCredentialsSignIn(request('/api/auth/csrf'))).toBe(false);
  });

  it('does not match a path that merely contains the word', () => {
    expect(isCredentialsSignIn(request('/api/auth/callback/credentials-extra'))).toBe(false);
  });
});

describe('consumeSignInAttempt, per address', () => {
  it('allows the first eight attempts and blocks the ninth', () => {
    const email = `${unique('addr')}@lifeos.test`;
    const ip = unique('10.0.0');

    const allowed = Array.from({ length: 8 }, () =>
      consumeSignInAttempt(request(credentials, ip), email),
    );
    expect(allowed.every((r) => r.allowed)).toBe(true);

    const blocked = consumeSignInAttempt(request(credentials, ip), email);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('address');
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('treats the address case-insensitively, so casing is not a free retry', () => {
    const local = unique('case');
    const ip = unique('10.1.0');
    const mixed = `${local}@Lifeos.Test`;

    for (let i = 0; i < 8; i++) {
      expect(consumeSignInAttempt(request(credentials, ip), mixed).allowed).toBe(true);
    }
    // Same account, different capitalisation.
    const blocked = consumeSignInAttempt(request(credentials, ip), `${local}@lifeos.test`);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('address');
  });

  it('does not let one address consume another address budget', () => {
    const ip = unique('10.2.0');
    const target = `${unique('victim')}@lifeos.test`;
    for (let i = 0; i < 8; i++) consumeSignInAttempt(request(credentials, ip), target);
    expect(consumeSignInAttempt(request(credentials, ip), target).allowed).toBe(false);

    const other = `${unique('other')}@lifeos.test`;
    expect(consumeSignInAttempt(request(credentials, ip), other).allowed).toBe(true);
  });
});

describe('consumeSignInAttempt, per address space', () => {
  it('allows forty distinct addresses from one host and blocks the next', () => {
    const ip = unique('10.3.0');
    for (let i = 0; i < 40; i++) {
      expect(consumeSignInAttempt(request(credentials, ip), `${unique('spray')}@lifeos.test`).allowed).toBe(true);
    }
    const blocked = consumeSignInAttempt(request(credentials, ip), `${unique('spray')}@lifeos.test`);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('ip');
  });

  it('reads the first entry of a forwarded-for chain', () => {
    const ip = unique('10.4.0');
    for (let i = 0; i < 40; i++) {
      consumeSignInAttempt(request(credentials, `${ip}, 172.16.0.9`), `${unique('c')}@lifeos.test`);
    }
    // Same leading address, so the same bucket is exhausted.
    const blocked = consumeSignInAttempt(
      request(credentials, `${ip}, 172.16.0.9`),
      `${unique('c')}@lifeos.test`,
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('ip');
  });

  it('falls back to real-ip when there is no forwarded-for', () => {
    const ip = unique('10.5.0');
    const withRealIp = () => {
      const headers = new Headers({ 'x-real-ip': ip });
      return new Request(`https://lifeos.test${credentials}`, { headers });
    };
    for (let i = 0; i < 40; i++) {
      consumeSignInAttempt(withRealIp(), `${unique('d')}@lifeos.test`);
    }
    const blocked = consumeSignInAttempt(withRealIp(), `${unique('d')}@lifeos.test`);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('ip');
  });

  it('groups requests with no address at all into one bucket', () => {
    // Better to throttle a client that hides its address than to let it through
    // unmetered for free.
    for (let i = 0; i < 40; i++) consumeSignInAttempt(request(credentials), null);
    const blocked = consumeSignInAttempt(request(credentials), null);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('ip');
  });

  it('does not let a missing address skip the per-IP budget', () => {
    const ip = unique('10.6.0');
    for (let i = 0; i < 40; i++) {
      consumeSignInAttempt(request(credentials, ip), `${unique('e')}@lifeos.test`);
    }
    // No email at all: must still be counted against the exhausted IP bucket.
    const blocked = consumeSignInAttempt(request(credentials, ip), null);
    expect(blocked.allowed).toBe(false);
  });
});

describe('consumeSignInAttempt, successful-attempt accounting', () => {
  it('counts an attempt whether or not the password is right', () => {
    // The limiter cannot know the outcome, and must not try: a limit that only
    // counted failures could be walked past by sending the correct password first.
    const email = `${unique('f')}@lifeos.test`;
    const ip = unique('10.7.0');
    for (let i = 0; i < 8; i++) {
      expect(consumeSignInAttempt(request(credentials, ip), email).allowed).toBe(true);
    }
    expect(consumeSignInAttempt(request(credentials, ip), email).allowed).toBe(false);
  });
});
