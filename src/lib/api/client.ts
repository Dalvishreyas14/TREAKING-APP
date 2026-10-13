/**
 * Browser-side counterpart to the server's `withApi` envelope.
 *
 * Every API call unwraps to data or throws an `ApiClientError` carrying the
 * server's user-facing message plus any per-field issues, so forms can bind
 * errors to inputs without re-parsing responses.
 */

export class ApiClientError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.details = details;
  }

  /** Field-level messages, when the failure was a validation error. */
  get fieldErrors(): Record<string, string> {
    if (this.details && typeof this.details === "object" && !Array.isArray(this.details)) {
      return this.details as Record<string, string>;
    }
    return {};
  }
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export async function apiRequest<T>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<T> {
  const { body, headers, ...rest } = init;

  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // Never let a cached auth response survive a sign-out.
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;

  let envelope: Envelope<T>;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    // A non-JSON body means something upstream of us failed.
    throw new ApiClientError(
      "We could not reach the server. Check your connection and try again.",
      "NETWORK_ERROR",
    );
  }

  if (!res.ok || !envelope.ok) {
    throw new ApiClientError(
      envelope.error?.message ?? "Something went wrong. Please try again.",
      envelope.error?.code ?? "UNKNOWN",
      envelope.error?.details,
    );
  }

  return envelope.data as T;
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "PATCH", body }),
  /**
   * PUT is used by the API for whole-substitution style operations, not for
   * "update some fields" — reordering a routine's steps is the one that exists
   * today. It is a separate verb here rather than folded into `patch` so a
   * caller cannot accidentally send a reorder intent down a partial-update path.
   */
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: "DELETE" }),
};
