/**
 * Normalization pass over CMS page HTML, applied at render time.
 *
 * The Shopify→Mercora ETL left artifacts in migrated page bodies: empty
 * paragraphs used as spacers, hidden divs, stray <meta charset> tags, and
 * questions marked up as bold paragraphs rather than headings. Cleaning these
 * at render time (rather than rewriting stored content) keeps the CMS source
 * editable and fixes any future imported page for free.
 *
 * Runs AFTER sanitization, so the markup is already well-formed and the
 * allowlist has been applied.
 */

/**
 * Paragraphs and divs holding nothing but whitespace/&nbsp; were used as Shopify
 * spacers. Attributes are tolerated: the sanitizer keeps `class` on every tag
 * ("*": ["class"]), so real exported spacers survive as
 * `<div class="privy-embed-form"></div>` — a bare-tag match would miss them and
 * they are still in the seeded content today. The backreference keeps the pair
 * matched, so a mismatched `<p>…</div>` is not collapsed.
 */
const EMPTY_ELEMENT = /<(p|div)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi;

/**
 * Defense-in-depth only. On the render path the sanitizer has already dropped
 * `style` (not in allowedAttributes) and `<meta>` (not in allowedTags), so none
 * of these three match — the emptied `<div>` a stripped `style` leaves behind is
 * removed by EMPTY_ELEMENT instead. They are kept because normalizePageHtml is
 * also exercised directly by tests and is safe to point at raw ETL output, where
 * sanitization has not run.
 */
const HIDDEN_DIV = /<div[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>\s*<\/div>/gi;
const STRAY_META = /<meta[^>]*>/gi;
const STYLE_ATTR = /\s+style=["'][^"']*["']/gi;

/**
 * A paragraph whose entire content is one or more bold runs — the shape the
 * Shopify FAQ export used for questions.
 */
const BOLD_ONLY_PARAGRAPH = /<p>((?:\s*<(?:strong|b)>[\s\S]*?<\/(?:strong|b)>\s*)+)<\/p>/gi;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

export function normalizePageHtml(html: string): string {
  let normalized = html
    .replace(HIDDEN_DIV, "")
    .replace(STRAY_META, "")
    .replace(STYLE_ATTR, "")
    .replace(BOLD_ONLY_PARAGRAPH, (match, inner: string) => {
      const text = stripTags(inner).replace(/\s+/g, " ").trim();
      // Only promote actual questions. "Last Updated:" and similar bold labels
      // must stay paragraphs, or legal pages sprout spurious sections.
      return text.endsWith("?") ? `<h2>${text}</h2>` : match;
    })
    .replace(EMPTY_ELEMENT, "");

  // Removing an empty element can leave its parent empty in turn
  // (`<div><p></p></div>`), which one left-to-right pass cannot catch. Bounded
  // so a pathological input cannot spin.
  for (let pass = 0; pass < 5; pass++) {
    const collapsed = normalized.replace(EMPTY_ELEMENT, "");
    if (collapsed === normalized) break;
    normalized = collapsed;
  }

  return normalized.trim();
}
