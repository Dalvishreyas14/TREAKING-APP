import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Prisma 7 requires an explicit driver adapter - there is no bundled query
 * engine any more. The adapter owns the pg connection pool, so pooling is
 * configured here rather than through Prisma.
 *
 * In development Next.js re-evaluates modules on every HMR pass. Caching the
 * client on globalThis keeps a single pool alive instead of leaking one per
 * reload, which is the classic cause of "too many connections" in dev.
 */
function createPrismaClient() {
  const connectionString = env().DATABASE_URL;

  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Convenience wrapper so service code reads `db.task.findMany(...)`.
 * Re-exporting the namespace keeps call sites terse without leaking the
 * client instance into templates or client components.
 */
import * as db from "@/generated/prisma/client";
export { db };
export type { PrismaClient };
