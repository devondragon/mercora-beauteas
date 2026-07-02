/**
 * Regression tests for BMC-156 / L6 — knowledge article R2 keys were built
 * directly from a client-supplied filename with no rejection of "/", "\",
 * or "..". R2 keys are a flat namespace so there's no practical traversal
 * exploit today, but a filename containing a path separator or ".." should
 * still be rejected before it's used to build a key (defense-in-depth).
 *
 * Exercises the pure helper used by app/api/admin/knowledge/route.ts and
 * app/api/admin/knowledge/vectorize-status/route.ts.
 */
import { describe, it, expect } from 'vitest';
import { isSafeKnowledgeFilename } from '@/lib/utils/safe-filename';

describe('isSafeKnowledgeFilename', () => {
  it('rejects a relative path traversal segment', () => {
    expect(isSafeKnowledgeFilename('../x')).toBe(false);
  });

  it('rejects a forward-slash path separator', () => {
    expect(isSafeKnowledgeFilename('a/b')).toBe(false);
  });

  it('rejects a backslash path separator', () => {
    expect(isSafeKnowledgeFilename('a\\b')).toBe(false);
  });

  it('rejects a bare ".."', () => {
    expect(isSafeKnowledgeFilename('..')).toBe(false);
  });

  it('rejects a bare "."', () => {
    expect(isSafeKnowledgeFilename('.')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isSafeKnowledgeFilename('')).toBe(false);
  });

  it('rejects a whitespace-only string', () => {
    expect(isSafeKnowledgeFilename('   ')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isSafeKnowledgeFilename(undefined)).toBe(false);
    expect(isSafeKnowledgeFilename(null)).toBe(false);
    expect(isSafeKnowledgeFilename(123)).toBe(false);
  });

  it('rejects a filename with an embedded ".." even without separators', () => {
    expect(isSafeKnowledgeFilename('a..b')).toBe(false);
  });

  it('accepts a normal markdown filename', () => {
    expect(isSafeKnowledgeFilename('guide.md')).toBe(true);
  });

  it('accepts a normal filename without extension', () => {
    expect(isSafeKnowledgeFilename('my_doc')).toBe(true);
  });
});
