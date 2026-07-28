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
 * Paragraphs and divs holding nothing but whitespace/&nbsp; were used as Shopify spacers.
 * Matches both `<p>...</p>` and `<div>...</div>` after their attributes are stripped.
 */
const EMPTY_ELEMENT = /(?:<p>|<div>)(?:\s|&nbsp;|<br\s*\/?>)*(?:<\/p>|<\/div>)/gi;

/** Hidden divs and stray <meta> tags the export scattered through the body. */
const HIDDEN_DIV = /<div[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>\s*<\/div>/gi;
const STRAY_META = /<meta[^>]*>/gi;

/** `style` is not on the sanitizer allowlist, but legacy stored HTML still has it. */
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
  return html
    .replace(HIDDEN_DIV, "")
    .replace(STRAY_META, "")
    .replace(STYLE_ATTR, "")
    .replace(BOLD_ONLY_PARAGRAPH, (match, inner: string) => {
      const text = stripTags(inner).replace(/\s+/g, " ").trim();
      // Only promote actual questions. "Last Updated:" and similar bold labels
      // must stay paragraphs, or legal pages sprout spurious sections.
      return text.endsWith("?") ? `<h2>${text}</h2>` : match;
    })
    .replace(EMPTY_ELEMENT, "")
    .trim();
}
