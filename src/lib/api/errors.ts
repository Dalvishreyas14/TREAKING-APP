/**
 * A single, typed error vocabulary for the whole API.
 *
 * Every failure the product can produce is one of these codes, which is what
 * lets the UI render a calm, human message instead of surfacing a stack trace
 * or a Prisma message. The user-facing `message` is written to be shown to a
 * person; anything technical belongs in `details`, which is only ever logged.
 */
export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  AI_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  static badRequest(message = "That request could not be understood.", details?: unknown) {
    return new ApiError("BAD_REQUEST", message, details);
  }

  static validation(message = "Some fields need attention.", details?: unknown) {
    return new ApiError("VALIDATION_ERROR", message, details);
  }

  static unauthorized(message = "You need to sign in to do that.") {
    return new ApiError("UNAUTHORIZED", message);
  }

  static forbidden(message = "You do not have access to that.") {
    return new ApiError("FORBIDDEN", message);
  }

  static notFound(message = "We could not find that.") {
    return new ApiError("NOT_FOUND", message);
  }

  static conflict(message = "That already exists.") {
    return new ApiError("CONFLICT", message);
  }

  static rateLimited(message = "Too many requests. Give it a moment.") {
    return new ApiError("RATE_LIMITED", message);
  }

  static aiUnavailable(message = "The assistant is unavailable right now.") {
    return new ApiError("AI_UNAVAILABLE", message);
  }

  static internal(message = "Something went wrong on our side.") {
    return new ApiError("INTERNAL_ERROR", message);
  }
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: ApiErrorCode; message: string; details?: unknown };
}

/** Narrow an unknown value to an ApiError without losing the original. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return ApiError.internal();
}
