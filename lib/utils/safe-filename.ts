/**
 * Pure helper for validating client-supplied knowledge article filenames
 * before they're used to build an R2 object key (BMC-156 / L6).
 *
 * R2 keys are a flat namespace, so there's no practical path-traversal
 * exploit today, but a filename containing "/", "\", or ".." should still
 * be rejected as defense-in-depth against unexpected key collisions/writes
 * outside the intended `knowledge_md/` prefix.
 *
 * Kept dependency-free so it can be unit tested directly and reused by
 * every route that consumes a client filename for the knowledge R2 keys:
 * app/api/admin/knowledge/route.ts and
 * app/api/admin/knowledge/vectorize-status/route.ts.
 */

/**
 * Returns true when `name` is safe to use as (or to derive) an R2 key
 * segment: non-empty, not just whitespace, and free of path separators
 * or any ".." sequence (rejected wherever it appears, not only as a
 * standalone path segment).
 */
export function isSafeKnowledgeFilename(name: unknown): name is string {
  if (typeof name !== 'string') {
    return false;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return false;
  }
  if (trimmed === '.' || trimmed === '..' || trimmed.includes('..')) {
    return false;
  }
  return true;
}
