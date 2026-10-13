import "server-only";
import { z } from "zod";

/**
 * Server-only environment contract.
 *
 * Every secret is read here and nowhere else. Nothing in this module may be
 * imported from a Client Component - the `server-only` guard enforces that at
 * build time, so a leak becomes a compile error rather than a shipped secret.
 */

const serverSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  AUTH_URL: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  TOKEN_ENCRYPTION_KEY: z.string().min(1, "TOKEN_ENCRYPTION_KEY is required"),

  AI_PROVIDER: z
    .enum(["local", "openai", "anthropic", "google"])
    .default("local"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),

  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),

  EMAIL_TRANSPORT: z.enum(["dev", "resend"]).default("dev"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("LIFEOS <noreply@lifeos.local>"),
});

function load() {
  const parsed = serverSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  return parsed.data;
}

let cached: z.infer<typeof serverSchema> | undefined;

export function env() {
  cached ??= load();
  return cached;
}

/** True when a real LLM provider is configured and consented to. */
export function hasLlmProvider(): boolean {
  const e = env();
  switch (e.AI_PROVIDER) {
    case "openai":
      return Boolean(e.OPENAI_API_KEY);
    case "anthropic":
      return Boolean(e.ANTHROPIC_API_KEY);
    case "google":
      return Boolean(e.GOOGLE_GENERATIVE_AI_API_KEY);
    default:
      return false;
  }
}

/** Google OAuth is only offered when both halves of the credential exist. */
export function googleAuthEnabled(): boolean {
  const e = env();
  return Boolean(e.AUTH_GOOGLE_ID && e.AUTH_GOOGLE_SECRET);
}

/**
 * True when mail is written to disk instead of being delivered.
 *
 * The signup and verification screens use this to surface the action link
 * directly, so the flow is completable on a laptop with no mail account. This
 * is gated on EMAIL_TRANSPORT rather than NODE_ENV alone, because the two can
 * legitimately disagree in a staging deployment.
 */
export function devMailEnabled(): boolean {
  return env().EMAIL_TRANSPORT === "dev";
}
