import type { NextAuthConfig } from "next-auth";

export type { NextAuthConfig };

/**
 * Callback argument types, derived from the config rather than imported from
 * Auth.js internals. This keeps the helpers correctly typed while depending
 * only on the public `NextAuthConfig` surface.
 */
type Callbacks = NonNullable<NextAuthConfig["callbacks"]>;
export type JwtArgs = Parameters<NonNullable<Callbacks["jwt"]>>[0];
export type SessionArgs = Parameters<NonNullable<Callbacks["session"]>>[0];

/**
 * Copies the subject onto the token at sign-in.
 *
 * Kept as a standalone function so the edge-safe config and the database-backed
 * config can share it without one reaching into the other's callbacks.
 */
export function stampSubject({ token, user }: JwtArgs) {
  if (user?.id) {
    token.sub = user.id;
    token.emailVerified = Boolean(user.emailVerified);
  }
  return token;
}

/**
 * Copies the subject from the token onto the session.
 *
 * Guarded on `session.user` because it is optional on the default session type;
 * a session without a user must stay that way, since every guard in the app
 * treats a missing user as unauthenticated.
 */
export function attachSubject({ session, token }: SessionArgs) {
  if (!token.sub || !session.user) return session;
  session.user.id = token.sub;
  return session;
}

/**
 * Edge-safe Auth.js configuration.
 *
 * This file is imported by proxy.ts, which runs on every matched request. It
 * therefore must not pull in Prisma or the argon2 native module - doing so would
 * open a database connection just to read a cookie. The database-aware pieces
 * live in ./index.ts, which extends this object.
 */
export const authConfig = {
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  session: {
    // Credentials sign-in cannot use database sessions, so we issue a signed
    // JWT. A day, not a week: a JWT cannot be revoked by deletion, and
    // ./index.ts shortens the effective life further whenever the password
    // changes. Anything longer widens the window for a stolen cookie.
    strategy: "jwt",
    maxAge: 60 * 60 * 24, // 24 hours
  },
  trustHost: true,
  callbacks: {
    /**
     * Authorisation is decided here, once, and everything downstream trusts
     * this shape.
     *
     * Note the deliberate use of `token.sub` rather than an existence check on
     * the session object. In next-auth <= 5.0.0-beta.31 a configuration error
     * produced a truthy `auth` object and any `if (auth)` guard failed OPEN.
     * Checking for a concrete subject fails CLOSED, which is the only safe
     * default. See GHSA-8fpg-xm3f-6cx3.
     */
    jwt(args) {
      return stampSubject(args);
    },
    session(args) {
      return attachSubject(args);
    },
  },
  providers: [],
} satisfies NextAuthConfig;
