/**
 * Argon2id cost parameters, shared by the app and the seed script.
 *
 * Deliberately free of any `server-only` guard and of the argon2 import itself,
 * so `prisma/seed.ts` - which runs under plain tsx, outside the React Server
 * Component graph - can hash demo passwords with byte-identical settings. If
 * these lived only in password.ts the seed would silently drift from the app.
 *
 * Values follow the OWASP Password Storage Cheat Sheet minimum:
 * 19 MiB memory, 2 iterations, 1 lane.
 *
 * `algorithm` is intentionally absent. @node-rs/argon2 defaults to argon2id,
 * and its `Algorithm` export is an ambient const enum that cannot be referenced
 * under `verbatimModuleSyntax`.
 */
export const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;
