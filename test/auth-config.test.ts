import { describe, expect, it } from 'vitest';

import { attachSubject, stampSubject } from '@/lib/auth/config';

/**
 * These two helpers are the whole authorisation contract that both the edge-safe
 * and the database-backed Auth.js configs share, so they are worth pinning down
 * precisely. The token/session shapes below are the minimum the callbacks
 * actually read.
 */

type StampArgs = Parameters<typeof stampSubject>[0];
type AttachArgs = Parameters<typeof attachSubject>[0];

const asUser = (overrides: Record<string, unknown> = {}) =>
  ({ id: 'user_123', email: 'demo@lifeos.app', emailVerified: new Date(), ...overrides }) as unknown as StampArgs['user'];

const asToken = (overrides: Record<string, unknown> = {}) =>
  ({ sub: undefined, ...overrides }) as StampArgs['token'];

const asSession = (overrides: Record<string, unknown> = {}) =>
  ({ user: { id: '', name: 'Alex' }, expires: '', ...overrides }) as unknown as AttachArgs['session'];

describe('stampSubject', () => {
  it('copies the id onto sub and flags verification', () => {
    const token = stampSubject({ token: asToken(), user: asUser() } as StampArgs);
    expect(token.sub).toBe('user_123');
    expect(token.emailVerified).toBe(true);
  });

  it('records an unverified account as unverified', () => {
    const token = stampSubject({
      token: asToken(),
      user: asUser({ emailVerified: null }),
    } as StampArgs);
    expect(token.emailVerified).toBe(false);
  });

  it('leaves the token untouched when there is no user', () => {
    // The refresh path: a token is re-signed with no user in the arguments, and
    // overwriting sub here would be how a session silently loses its subject.
    const original = asToken({ sub: 'user_123' });
    const token = stampSubject({
      token: original,
      user: undefined,
    } as unknown as StampArgs);
    expect(token.sub).toBe('user_123');
  });

  it('does not invent a subject when the user has no id', () => {
    const token = stampSubject({ token: asToken(), user: asUser({ id: undefined }) } as StampArgs);
    expect(token.sub).toBeUndefined();
  });

  it('mutates and returns the same token, so Auth.js sees the update', () => {
    const token = asToken();
    const returned = stampSubject({ token, user: asUser() } as StampArgs);
    expect(returned).toBe(token);
  });
});

describe('attachSubject', () => {
  it('copies sub onto the session user', () => {
    const session = attachSubject({
      session: asSession(),
      token: asToken({ sub: 'user_123' }),
    } as AttachArgs);
    expect(session.user?.id).toBe('user_123');
  });

  it('fails closed when the token has no subject', () => {
    // A session with no concrete id is what every guard in the app treats as
    // unauthenticated, so this must never produce a half-populated session.
    const session = attachSubject({
      session: asSession({ user: undefined }),
      token: asToken({ sub: undefined }),
    } as AttachArgs);
    expect(session.user).toBeUndefined();
  });

  it('leaves a userless session alone rather than creating one', () => {
    const session = attachSubject({
      session: asSession({ user: undefined }),
      token: asToken({ sub: 'user_123' }),
    } as AttachArgs);
    expect(session.user).toBeUndefined();
  });

  it('mutates and returns the same session', () => {
    const session = asSession();
    const returned = attachSubject({ session, token: asToken({ sub: 'user_123' }) } as AttachArgs);
    expect(returned).toBe(session);
  });
});

describe('token and session round trip', () => {
  it('a stamped token yields a session carrying the same id', () => {
    const token = stampSubject({ token: asToken(), user: asUser() } as StampArgs);
    const session = attachSubject({ session: asSession(), token } as AttachArgs);
    expect(session.user?.id).toBe(token.sub);
  });
});
