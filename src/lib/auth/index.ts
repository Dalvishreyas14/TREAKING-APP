import "server-only";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { prisma } from "@/lib/db";
import { googleAuthEnabled } from "@/lib/env";
import { authConfig, stampSubject, attachSubject, type NextAuthConfig } from "./config";
import { verifyPassword } from "./password";
import { normalizeEmail } from "./tokens";

/**
 * Full Auth.js configuration: database adapter + credentials + optional Google.
 *
 * The Prisma adapter handles OAuth account linking, verification tokens and
 * sessions. Credentials sign-in uses the JWT strategy, so the adapter is not
 * consulted for session reads.
 *
 * Sign-in rate limiting deliberately does NOT live here. It is applied by the
 * route handler in /api/auth/[...nextauth]/route.ts, which is the only path to
 * `authorize` for credentials and which can answer with a real 429 instead of an
 * error redirect. See ./sign-in-limit.ts.
 */

const providers: NextAuthConfig["providers"] = [
  Credentials({
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw) {
      const email = typeof raw?.email === "string" ? normalizeEmail(raw.email) : "";
      const password = typeof raw?.password === "string" ? raw.password : "";

      if (!email || !password) return null;

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          emailVerified: true,
          passwordHash: true,
          onboardedAt: true,
        },
      });

      // Always run a verification even when the user is missing, so response
      // timing does not reveal whether an address is registered.
      const hash = user?.passwordHash ?? DUMMY_HASH;
      const ok = await verifyPassword(hash, password);

      if (!user || !user.passwordHash || !ok) return null;

      // Unverified accounts are refused here rather than being allowed in and
      // gated later, so an unverified session can never exist.
      if (!user.emailVerified) {
        throw new Error("EMAIL_NOT_VERIFIED");
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        emailVerified: user.emailVerified,
        onboardedAt: user.onboardedAt,
      };
    },
  }),
];

// Only registered when the credential pair exists, otherwise Auth.js throws at
// boot and takes the whole app down.
if (googleAuthEnabled()) {
  providers.push(
    Google({
      allowDangerousEmailAccountLinking: false,
    }),
  );
}

/**
 * A real argon2id hash of a random value that no one knows. Verifying against
 * it costs the same as verifying a genuine password, which is what keeps the
 * "unknown email" path indistinguishable in wall-clock time from the "wrong
 * password" path. It must be a structurally valid hash or verification would
 * throw immediately and reintroduce the timing signal.
 */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$JlFzgbelOwUYU8EOVpBD0w$Q2joMWISS8PMRVqDscxYdFs1tbLtxhQmK/obEpnXhMw";

/**
 * Reads the password marker for a user.
 *
 * Deliberately uncached. An earlier version cached this for 30s and tried to
 * flush the cache on reset, but the reset route and the Auth.js handler can
 * hold separate module instances, so the flush did not always reach the map the
 * session callback read - leaving a revoked session alive for the rest of the
 * window. A revocation that depends on cache invalidation is not a revocation.
 *
 * This is one indexed primary-key lookup, and it only runs when a session is
 * actually read, so the cost is acceptable and the behaviour is correct.
 */
async function passwordMarker(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordChangedAt: true },
  });
  return user?.passwordChangedAt?.getTime() ?? 0;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers,
  callbacks: {
    /**
     * Composed from the shared helpers rather than reimplemented, so the
     * edge-safe and database-aware paths cannot drift apart on how a subject
     * is established.
     */
    async jwt(args) {
      const stamped = stampSubject(args);
      if (args.user?.id) {
        // Snapshot the password state this token was minted against, so a later
        // change can be detected.
        stamped.pwd = await passwordMarker(args.user.id);
      }
      return stamped;
    },

    /**
     * Invalidates sessions issued before the most recent password change.
     *
     * This is what makes a reset actually revoke access. Under the JWT strategy
     * there are no Session rows, so deleting them would be a no-op and a stolen
     * cookie would remain good until it expired.
     *
     * Returns a session with no user rather than throwing, because this callback
     * has no clean failure path. `requireUser` checks for a concrete id, so an
     * empty session is a 401 everywhere it matters.
     */
    async session(args) {
      const next = attachSubject(args);
      const { token } = args;
      if (!token.sub) return next;

      const expected = await passwordMarker(token.sub);
      const claimed = typeof token.pwd === "number" ? token.pwd : expected;

      if (claimed !== expected) {
        return { ...next, user: undefined };
      }
      return next;
    },
  },
  events: {
    /**
     * Keep gamification state in step with authentication. `signIn` fires for
     * both credentials and OAuth, so this is the single place a new user gets
     * their stats row - no duplicate provisioning logic per provider.
     */
    async signIn({ user }) {
      if (!user.id) return;
      await prisma.userStats.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
      });
    },
  },
});

export type { NextAuthConfig } from "./config";
