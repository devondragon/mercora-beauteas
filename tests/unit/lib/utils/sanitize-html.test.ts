/**
 * Regression tests for BMC-143 / H6 — stored XSS: CMS page HTML, the maintenance
 * banner, and AI-generated admin content were rendered unescaped via
 * `dangerouslySetInnerHTML`. Sanitization is now applied server-side at write
 * time (`sanitizePageHtmlServer` / `sanitizeBlogHtmlServer`, the authoritative
 * gate) and again client-side at render time (`sanitizeBlogHtml`, DOMPurify) as
 * defense-in-depth. Both layers share the same allowlist and must stay in sync,
 * so these tests pin the security-critical behavior of every path.
 *
 * The server helpers are imported from `sanitize-html-core` (not
 * `sanitize-html-server`) to avoid the `import "server-only"` guard, which throws
 * outside a React Server Component graph.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeBlogHtmlServer,
  sanitizePageHtmlServer,
} from '@/lib/utils/sanitize-html-core';
import { sanitizeBlogHtml } from '@/lib/utils/sanitize-html';

// The page sanitizer is intentionally an alias of the blog sanitizer (same
// rich-text allowlist). Run the same suite against every entry point so a future
// divergence in any one layer is caught.
const sanitizers: Array<[string, (html: string) => string]> = [
  ['sanitizeBlogHtmlServer (server / sanitize-html)', sanitizeBlogHtmlServer],
  ['sanitizePageHtmlServer (server / sanitize-html)', sanitizePageHtmlServer],
  ['sanitizeBlogHtml (client / DOMPurify)', sanitizeBlogHtml],
];

describe.each(sanitizers)('%s', (_name, sanitize) => {
  it('strips <script> tags', () => {
    const out = sanitize('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(1)');
    expect(out).toContain('<p>hi</p>');
  });

  it('strips inline event-handler attributes', () => {
    const out = sanitize('<img src="https://img.beauteas.com/a.png" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('strips onload/onclick handlers on allowed tags', () => {
    const out = sanitize('<div onclick="steal()"><span onload="x()">hi</span></div>');
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out.toLowerCase()).not.toContain('onload');
  });

  it('drops javascript: URIs in href', () => {
    const out = sanitize('<a href="javascript:alert(1)">click</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('drops data: URIs in img src', () => {
    const out = sanitize('<img src="data:text/html,<script>alert(1)</script>">');
    expect(out.toLowerCase()).not.toContain('data:');
    expect(out).not.toContain('alert(1)');
  });

  it('strips img src pointing at a non-allowlisted origin', () => {
    const out = sanitize('<img src="https://evil.com/track.gif" alt="x">');
    expect(out).not.toContain('evil.com');
  });

  it('strips protocol-relative img src (//evil.com)', () => {
    const out = sanitize('<img src="//evil.com/track.gif" alt="x">');
    expect(out).not.toContain('evil.com');
  });

  it('keeps img src on the allowlisted CDN origin', () => {
    const out = sanitize('<img src="https://img.beauteas.com/a.png" alt="tea">');
    expect(out).toContain('https://img.beauteas.com/a.png');
  });

  it('keeps relative img src', () => {
    const out = sanitize('<img src="/local.png" alt="tea">');
    expect(out).toContain('/local.png');
  });

  it('enforces rel="noopener noreferrer" on target=_blank links', () => {
    const out = sanitize('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('noopener');
    expect(out).toContain('noreferrer');
  });

  it('preserves allowlisted rich-text markup', () => {
    const html =
      '<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p><ul><li>one</li></ul>';
    const out = sanitize(html);
    expect(out).toContain('<h2>');
    expect(out).toContain('<strong>');
    expect(out).toContain('<em>');
    expect(out).toContain('<li>');
  });

  it('reduces script-only input to empty (nothing renderable survives)', () => {
    const out = sanitize('<script>alert(1)</script>').trim();
    expect(out).toBe('');
  });
});
