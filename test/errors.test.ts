import { describe, expect, it } from 'vitest';

import { ApiError, toApiError, type ApiErrorCode } from '@/lib/api/errors';

describe('API error vocabulary', () => {
  it('maps every code to a deliberate status', () => {
    const expected: Record<ApiErrorCode, number> = {
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

    for (const [code, status] of Object.entries(expected)) {
      const error = new ApiError(code as ApiErrorCode, 'x');
      expect(error.status, code).toBe(status);
      expect(error.code).toBe(code);
    }
  });

  it('constructors set the matching code', () => {
    expect(ApiError.badRequest().code).toBe('BAD_REQUEST');
    expect(ApiError.validation().code).toBe('VALIDATION_ERROR');
    expect(ApiError.unauthorized().code).toBe('UNAUTHORIZED');
    expect(ApiError.forbidden().code).toBe('FORBIDDEN');
    expect(ApiError.notFound().code).toBe('NOT_FOUND');
    expect(ApiError.conflict().code).toBe('CONFLICT');
    expect(ApiError.rateLimited().code).toBe('RATE_LIMITED');
    expect(ApiError.aiUnavailable().code).toBe('AI_UNAVAILABLE');
    expect(ApiError.internal().code).toBe('INTERNAL_ERROR');
  });

  it('carries details without putting them in the message', () => {
    const error = ApiError.validation('Some fields need attention.', {
      fields: { email: 'Enter a valid email address' },
    });
    expect(error.message).toBe('Some fields need attention.');
    expect(error.details).toEqual({ fields: { email: 'Enter a valid email address' } });
  });

  it('is a real Error, so stack traces survive', () => {
    const error = ApiError.internal();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.stack).toBeTruthy();
  });
});

describe('toApiError', () => {
  it('passes an ApiError through unchanged', () => {
    const original = ApiError.conflict('That already exists.');
    expect(toApiError(original)).toBe(original);
  });

  it('masks an arbitrary thrown value as a generic internal error', () => {
    // The message of a raw Prisma or Node error can leak schema and infrastructure
    // detail, so anything unrecognised must become the same opaque failure.
    const prismaError = Object.assign(new Error('relation "User" does not exist'), {
      code: 'P2001',
      meta: { table: 'User' },
    });
    const converted = toApiError(prismaError);

    expect(converted.code).toBe('INTERNAL_ERROR');
    expect(converted.status).toBe(500);
    expect(converted.message).toBe('Something went wrong on our side.');
    expect(converted.message).not.toContain('User');
  });

  it('handles non-Error throws', () => {
    for (const thrown of ['a string', 42, null, undefined, { code: 1 }]) {
      expect(toApiError(thrown).code).toBe('INTERNAL_ERROR');
    }
  });
});
