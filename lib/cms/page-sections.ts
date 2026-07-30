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

// Convention matchers deliberately tolerate extra attributes and extra classes:
// the sanitizer keeps `class` on every tag ("*": ["class"] in
// sanitize-html-core.ts) and the admin editor readily emits `class="specs mt-4"`
// or an id alongside it. An exact-match regex would let that markup fall through
// as raw prose — silently, with no error — so the class is matched as a
// whitespace-delimited token instead.
const CLASS_TOKEN = (token: string) => `class="(?:[^"]*\\s)?${token}(?:\\s[^"]*)?"`;
const SPECS_LIST = new RegExp(`<ul\\b[^>]*${CLASS_TOKEN("specs")}[^>]*>([\\s\\S]*?)<\\/ul>`, "gi");
const BLEND_FIGURE = new RegExp(
  `<figure\\b[^>]*${CLASS_TOKEN("blend")}[^>]*>([\\s\\S]*?)<\\/figure>`,
  "gi",
);
const BLOCKQUOTE = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
const LIST_ITEM = /<li[^>]*>([\s\S]*?)<\/li>/gi;
const FIRST_PARAGRAPH = /<p>([\s\S]*?)<\/p>/i;
const UPDATED_PARAGRAPH = /^\s*<p><strong>Last Updated:<\/strong>([\s\S]*?)<\/p>/i;
// Absolute links to our own origin are accepted too — only the slug is used.
const PRODUCT_HREF = /href="(?:https?:\/\/[^"/]+)?\/product\/([a-z0-9-]+)"/i;

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
// Void elements never open a scope, so they must not affect nesting depth.
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img",
  "input", "link", "meta", "param", "source", "track", "wbr",
]);

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

/**
 * Locate `<h2>` boundaries that sit at the top level of the document.
 *
 * Splitting on every `<h2>` regardless of depth would cut a wrapper element in
 * half and hand unbalanced fragments to `dangerouslySetInnerHTML` — a page whose
 * sections are wrapped in a `<div>` (which the admin editor can easily produce)
 * would emit an unclosed `<div>` as the lead and a stray `</div>` in the first
 * section. A nested heading is therefore left inline as ordinary markup instead.
 *
 * Depth tracking is safe here because the input is sanitize-html output, which
 * is balanced; the clamp below only guards against a malformed direct caller.
 */
function topLevelH2Boundaries(html: string): { heading: string; start: number; end: number }[] {
  const boundaries: { heading: string; start: number; end: number }[] = [];
  let depth = 0;
  let open: { start: number; contentStart: number } | null = null;

  for (const match of html.matchAll(TAG)) {
    const name = match[2].toLowerCase();
    if (VOID_TAGS.has(name) || match[3] === "/") continue;

    const index = match.index ?? 0;
    if (match[1] !== "/") {
      if (name === "h2" && depth === 0 && !open) {
        open = { start: index, contentStart: index + match[0].length };
      }
      depth++;
    } else {
      depth = Math.max(0, depth - 1);
      if (name === "h2" && depth === 0 && open) {
        boundaries.push({
          heading: toText(html.slice(open.contentStart, index)),
          start: open.start,
          end: index + match[0].length,
        });
        open = null;
      }
    }
  }

  return boundaries;
}

/**
 * Pulls the conventions out of a section body, returning the cleaned html.
 *
 * Only the `guide` template renders specs, callouts and the blend column
 * (SectionCard); the other templates render `html` alone. Extraction is
 * therefore opt-in — stripping this markup for a template that will not render
 * it deletes the author's content outright.
 */
function extractConventions(
  html: string,
  enabled: boolean,
): Omit<PageSection, "id" | "heading"> {
  if (!enabled) {
    return { html: html.trim(), specs: [], productSlug: null, callouts: [] };
  }

  let body = html;

  const specs: string[] = [];
  for (const specsMatch of body.matchAll(SPECS_LIST)) {
    for (const item of specsMatch[1].matchAll(LIST_ITEM)) {
      specs.push(toText(item[1]));
    }
  }
  body = body.replace(SPECS_LIST, "");

  let productSlug: string | null = null;
  body = body.replace(BLEND_FIGURE, (match, inner: string) => {
    const href = inner.match(PRODUCT_HREF);
    // Keep the figure inline unless it actually yields a rendered column: an
    // unresolvable href (or a second figure in one section, which the single
    // productSlug field cannot represent) would otherwise be deleted silently.
    if (!href || productSlug) return match;
    productSlug = href[1];
    return "";
  });

  const callouts: string[] = [];
  body = body.replace(BLOCKQUOTE, (_match, inner: string) => {
    callouts.push(toText(inner));
    return "";
  });

  return { html: body.trim(), specs, productSlug, callouts };
}

export interface ParsePageOptions {
  /** Promote the first paragraph to the hero lede. Off when a stored excerpt wins. */
  promoteLede?: boolean;
  /**
   * Lift `<ul class="specs">`, `<blockquote>` and `<figure class="blend">` out of
   * the body. Only enable for templates that render them (`guide`) — otherwise
   * the markup is removed and nothing puts it back.
   */
  extractConventions?: boolean;
  /**
   * Lift a leading "Last Updated:" paragraph into its own field. Only enable for
   * templates that render it (`legal`), for the same reason.
   */
  liftUpdatedLabel?: boolean;
}

export function parsePageHtml(html: string, options: ParsePageOptions = {}): ParsedPage {
  const {
    promoteLede = true,
    extractConventions: shouldExtract = true,
    liftUpdatedLabel = true,
  } = options;
  const normalized = normalizePageHtml(html);

  const boundaries = topLevelH2Boundaries(normalized);

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
      ...extractConventions(body, shouldExtract),
    };
  });

  // Lift a leading "Last Updated" line into its own field (legal pages).
  let updatedLabel: string | null = null;
  if (liftUpdatedLabel) {
    const updatedMatch = lead.match(UPDATED_PARAGRAPH);
    if (updatedMatch) {
      updatedLabel = `Last Updated:${updatedMatch[1]}`.replace(/\s+/g, " ").trim();
      lead = lead.slice(updatedMatch[0].length);
    }
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
