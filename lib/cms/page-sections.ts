/**
 * Parses sanitized CMS page HTML into the structured model the page templates
 * render from. Operating on sanitized output means the markup is already
 * well-formed and allowlisted, so regex scanning is safe here — and the result
 * is only ever re-injected, never used to widen the allowlist.
 */
import { normalizePageHtml } from "./page-html";

export interface PageSection {
  /** Slugified heading, used as the anchor target and rail link. */
  id: string;
  heading: string;
  /** Section body with the extracted conventions removed. */
  html: string;
  /** Chip labels lifted from `<ul class="specs">`. */
  specs: string[];
  /** Product slug lifted from `<figure class="blend">`, for the shoppable column. */
  productSlug: string | null;
  /** Plain-text callouts lifted from `<blockquote>`. */
  callouts: string[];
}

export interface ParsedPage {
  /** Text of a leading `<p><strong>Last Updated:</strong> …</p>`, for the legal pill. */
  updatedLabel: string | null;
  /** Hero lede, promoted out of the body when the page has an intro paragraph. */
  lede: string | null;
  /** Remaining content before the first `<h2>`. */
  lead: string;
  sections: PageSection[];
}

const H2_SPLIT = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
const SPECS_LIST = /<ul class="specs">([\s\S]*?)<\/ul>/i;
const BLEND_FIGURE = /<figure class="blend">([\s\S]*?)<\/figure>/gi;
const BLOCKQUOTE = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
const LIST_ITEM = /<li[^>]*>([\s\S]*?)<\/li>/gi;
const FIRST_PARAGRAPH = /<p>([\s\S]*?)<\/p>/i;
const UPDATED_PARAGRAPH = /^\s*<p><strong>Last Updated:<\/strong>([\s\S]*?)<\/p>/i;
const PRODUCT_HREF = /href="\/product\/([a-z0-9-]+)"/i;

function toText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyHeading(text: string): string {
  const slug = toText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/** Pulls the conventions out of a section body, returning the cleaned html. */
function extractConventions(html: string): Omit<PageSection, "id" | "heading"> {
  let body = html;

  const specs: string[] = [];
  const specsMatch = body.match(SPECS_LIST);
  if (specsMatch) {
    for (const item of specsMatch[1].matchAll(LIST_ITEM)) {
      specs.push(toText(item[1]));
    }
    body = body.replace(SPECS_LIST, "");
  }

  let productSlug: string | null = null;
  body = body.replace(BLEND_FIGURE, (_match, inner: string) => {
    const href = inner.match(PRODUCT_HREF);
    if (href) productSlug = href[1];
    return "";
  });

  const callouts: string[] = [];
  body = body.replace(BLOCKQUOTE, (_match, inner: string) => {
    callouts.push(toText(inner));
    return "";
  });

  return { html: body.trim(), specs, productSlug, callouts };
}

export function parsePageHtml(
  html: string,
  options: { promoteLede?: boolean } = {},
): ParsedPage {
  const { promoteLede = true } = options;
  const normalized = normalizePageHtml(html);

  // Split on top-level h2 boundaries.
  const boundaries: { heading: string; start: number; end: number }[] = [];
  for (const match of normalized.matchAll(H2_SPLIT)) {
    boundaries.push({
      heading: toText(match[1]),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }

  let lead = boundaries.length ? normalized.slice(0, boundaries[0].start) : normalized;

  const usedIds = new Map<string, number>();
  const sections: PageSection[] = boundaries.map((boundary, index) => {
    const next = boundaries[index + 1];
    const body = normalized.slice(boundary.end, next ? next.start : undefined);

    const base = slugifyHeading(boundary.heading);
    const seen = (usedIds.get(base) ?? 0) + 1;
    usedIds.set(base, seen);

    return {
      id: seen === 1 ? base : `${base}-${seen}`,
      heading: boundary.heading,
      ...extractConventions(body),
    };
  });

  // Lift a leading "Last Updated" line into its own field (legal pages).
  let updatedLabel: string | null = null;
  const updatedMatch = lead.match(UPDATED_PARAGRAPH);
  if (updatedMatch) {
    updatedLabel = `Last Updated:${updatedMatch[1]}`.replace(/\s+/g, " ").trim();
    lead = lead.slice(updatedMatch[0].length);
  }

  // Promote the first remaining paragraph to the hero lede.
  let lede: string | null = null;
  if (promoteLede) {
    const first = lead.match(FIRST_PARAGRAPH);
    if (first) {
      lede = toText(first[1]);
      lead = lead.replace(first[0], "");
    }
  }

  return { updatedLabel, lede, lead: lead.trim(), sections };
}
