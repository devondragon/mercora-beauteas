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

  // BMC-143 follow-up: safe formatting/semantic tags were being silently
  // dropped on save (data loss). They must now survive sanitization.
  it('preserves figure/figcaption', () => {
    const out = sanitize(
      '<figure><img src="/a.png" alt="tea"><figcaption>A cup</figcaption></figure>',
    );
    expect(out).toContain('<figure>');
    expect(out).toContain('<figcaption>');
  });

  it('preserves sub/sup', () => {
    const out = sanitize('<p>H<sub>2</sub>O and E=mc<sup>2</sup></p>');
    expect(out).toContain('<sub>');
    expect(out).toContain('<sup>');
  });

  it('preserves del/ins/s strikethrough + edit markup', () => {
    const out = sanitize('<p><del>old</del><ins>new</ins><s>gone</s></p>');
    expect(out).toContain('<del>');
    expect(out).toContain('<ins>');
    expect(out).toContain('<s>');
  });

  it('preserves small/mark/b/i inline formatting', () => {
    const out = sanitize('<p><small>fine</small> <mark>hi</mark> <b>b</b> <i>i</i></p>');
    expect(out).toContain('<small>');
    expect(out).toContain('<mark>');
    expect(out).toContain('<b>');
    expect(out).toContain('<i>');
  });

  it('preserves abbr with its title attribute', () => {
    const out = sanitize('<abbr title="United States Department of Agriculture">USDA</abbr>');
    expect(out).toContain('<abbr');
    expect(out).toContain('title="United States Department of Agriculture"');
  });

  it('preserves definition lists (dl/dt/dd)', () => {
    const out = sanitize('<dl><dt>Term</dt><dd>Definition</dd></dl>');
    expect(out).toContain('<dl>');
    expect(out).toContain('<dt>');
    expect(out).toContain('<dd>');
  });

  it('preserves table caption/colgroup/col', () => {
    const out = sanitize(
      '<table><caption>Blends</caption><colgroup><col span="2"></colgroup>' +
        '<tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
    );
    expect(out).toContain('<caption>');
    expect(out).toContain('<colgroup>');
    expect(out).toContain('<col');
    expect(out).toContain('span="2"');
  });

  // Dangerous embeds/scriptable tags must still be stripped — expanding the
  // allowlist for safe formatting must NOT open an injection surface.
  it('still strips iframe/object/embed/form/style/svg', () => {
    const out = sanitize(
      '<iframe src="https://evil.com"></iframe>' +
        '<object data="x.swf"></object>' +
        '<embed src="x.swf">' +
        '<form action="/steal"><input></form>' +
        '<style>body{display:none}</style>' +
        '<svg onload="alert(1)"></svg>' +
        '<p>ok</p>',
    );
    expect(out.toLowerCase()).not.toContain('<iframe');
    expect(out.toLowerCase()).not.toContain('<object');
    expect(out.toLowerCase()).not.toContain('<embed');
    expect(out.toLowerCase()).not.toContain('<form');
    expect(out.toLowerCase()).not.toContain('<style');
    expect(out.toLowerCase()).not.toContain('<svg');
    expect(out.toLowerCase()).not.toContain('alert(1)');
    expect(out).toContain('<p>ok</p>');
  });

  it('still strips event-handler attributes on newly-allowed tags', () => {
    const out = sanitize('<figure onclick="steal()"><sup onmouseover="x()">2</sup></figure>');
    expect(out.toLowerCase()).not.toContain('onclick');
    expect(out.toLowerCase()).not.toContain('onmouseover');
    expect(out).toContain('<figure>');
    expect(out).toContain('<sup>');
  });
});
