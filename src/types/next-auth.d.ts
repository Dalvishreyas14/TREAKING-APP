import type { DefaultSession } from "next-auth";

/**
 * Module augmentation for the session and token shapes.
 *
 * Declaring these once removes the `as` casts that would otherwise be needed at
 * every `session.user.emailVerified` and `token.pwd` read, and means a typo in
 * one of those fields becomes a compile error rather than `undefined`.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** Present once the address is confirmed. Null for OAuth-only accounts. */
      emailVerified: Date | null;
    } & DefaultSession["user"];
  }

  interface User {
    emailVerified?: Date | null;
  }

  interface JWT {
    emailVerified?: boolean;
    /**
     * The `passwordChangedAt` value in force when this token was minted.
     * Compared on read so a password reset revokes outstanding sessions.
     */
    pwd?: number;
  }
}

export {};
