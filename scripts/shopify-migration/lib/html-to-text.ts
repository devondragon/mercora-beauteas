/**
 * HTML → plain text for Shopify `body_html`.
 *
 * The storefront renders product/category descriptions as text (not HTML), so
 * raw Shopify markup must be flattened. Shopify also injects hidden blocks
 * (`<div style="display:none">…</div>`) holding duplicate marketing copy and
 * spreadsheet-paste junk (`data-sheets-*`); those are removed before stripping.
 *
 * Assumes hidden blocks are not nested with inner <div>s (true for Shopify's
 * paste markup) so a non-greedy match cleanly removes them whether empty
 * (categories) or content-filled (products).
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';

  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    // Drop hidden blocks (empty or content-filled)
    .replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
