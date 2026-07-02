/**
 * Regression tests for BMC-154 / L4 — several admin handlers returned raw
 * internal error details (`error.message` / `String(error)`) unconditionally
 * in the JSON response body, regardless of NODE_ENV, leaking DB/driver
 * internals to callers (including the lower-trust service token).
 *
 * Exercises the shared helper used by:
 * app/api/admin/pages/[id]/route.ts, app/api/admin/knowledge/route.ts,
 * app/api/admin/knowledge/vectorize-status/route.ts, and
 * app/api/admin/vectorize/route.ts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { errorDetails } from '@/lib/utils/error-response';

// NODE_ENV is typed read-only by @types/node, so tests use vi.stubEnv/
// vi.unstubAllEnvs (rather than direct assignment) to toggle it and always
// restore the original value afterward.
describe('errorDetails', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the Error message in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(errorDetails(new Error('db connection refused'))).toBe('db connection refused');
  });

  it('stringifies a non-Error value in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(errorDetails('raw string failure')).toBe('raw string failure');
  });

  it('returns undefined in production, even for an Error', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(errorDetails(new Error('db connection refused'))).toBeUndefined();
  });

  it('returns undefined for any non-development value (e.g. test)', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(errorDetails(new Error('leaked internals'))).toBeUndefined();
  });
});
