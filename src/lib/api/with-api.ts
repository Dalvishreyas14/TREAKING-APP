import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";

import { ApiError, toApiError, type ApiEnvelope } from "./errors";
import { requireUser, type SessionUser } from "@/lib/auth/guards";
import { rateLimit, type RateLimit } from "@/lib/rate-limit";

/**
 * The single entry point for every API route.
 *
 * Each handler declares its own auth, validation and rate-limit policy and gets
 * all of them applied consistently. Centralising this is what stops the classic
 * failure mode of one endpoint quietly skipping authorisation.
 */

interface HandlerContext<TParams> {
  req: NextRequest;
  params: TParams;
  user: SessionUser;
  /** Client IP, used as the rate-limit key. */
  ip: string;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RouteOptions<TBody, TQuery, TParams> {
  method: Method;
  /** Requires a session. Default true. */
  auth?: boolean;
  body?: ZodType<TBody>;
  query?: ZodType<TQuery>;
  params?: ZodType<TParams>;
  rateLimit?: RateLimit;
  handler: (
    ctx: HandlerContext<TParams> & { body: TBody; query: TQuery },
  ) => Promise<unknown> | unknown;
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

function fail(error: ApiError, retryAfterSeconds?: number) {
  const body: ApiEnvelope<never> = {
    ok: false,
    error: { code: error.code, message: error.message, details: error.details },
  };

  return NextResponse.json(body, {
    status: error.status,
    headers: retryAfterSeconds
      ? { "Retry-After": String(retryAfterSeconds) }
      : undefined,
  });
}

export function withApi<TBody = undefined, TQuery = undefined, TParams = undefined>(
  options: RouteOptions<TBody, TQuery, TParams>,
) {
  return async function route(
    req: NextRequest,
    context: { params: Promise<TParams> },
  ): Promise<NextResponse> {
    try {
      const needsAuth = options.auth !== false;
      const user = needsAuth ? await requireUser() : ({} as SessionUser);
      const ip = clientIp(req);

      if (options.rateLimit) {
        const { limit, windowMs } = options.rateLimit;
        const result = rateLimit(`${user.id ?? "anon"}:${ip}:${req.nextUrl.pathname}`, limit, windowMs);
        if (!result.allowed) {
          return fail(ApiError.rateLimited(), result.retryAfterSeconds);
        }
      }

      const params = options.params
        ? options.params.parse(await context.params)
        : ({} as TParams);

      let body = undefined as TBody;
      if (options.body) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          throw ApiError.badRequest("Request body must be valid JSON.");
        }
        const parsed = options.body.safeParse(raw);
        if (!parsed.success) {
          throw ApiError.validation("Some fields need attention.", fieldErrors(parsed.error));
        }
        body = parsed.data;
      }

      let query = undefined as TQuery;
      if (options.query) {
        const parsed = options.query.safeParse(
          Object.fromEntries(req.nextUrl.searchParams),
        );
        if (!parsed.success) {
          throw ApiError.validation("Some filters need attention.", fieldErrors(parsed.error));
        }
        query = parsed.data;
      }

      const data = await options.handler({
        req,
        params,
        user,
        ip,
        body: body as TBody,
        query: query as TQuery,
      });

      const payload: ApiEnvelope<unknown> = { ok: true, data };
      return NextResponse.json(payload, { status: 200 });
    } catch (error) {
      const apiError = toApiError(error);

      // Technical detail is logged, never returned. The Zod issues above are
      // field-level and safe to show, so they are the one exception.
      if (apiError.status >= 500) {
        console.error("[lifeos:api]", apiError.code, error);
      }

      return fail(apiError);
    }
  };
}

/** Flatten a ZodError into `{ field: "message" }` for form binding. */
function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
