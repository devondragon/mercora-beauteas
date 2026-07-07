import sanitizeHtml from "sanitize-html";

// Works in Cloudflare Workers: sanitize-html uses htmlparser2 (pure JS, no DOM).
// Called at write-time in the model layer before HTML is persisted — this is the
// authoritative security gate (browser-side DOMPurify is first-pass UX only).
//
// This core module has NO `server-only` guard so plain-Node ops scripts (e.g.
// scripts/sanitize-blog-html.ts run via tsx) can reuse it. App code must import
// from ./sanitize-html-server instead, which adds the bundle guard.

const RICH_HTML_OPTIONS: sanitizeHtml.IOptions = {
  // Clearly-safe formatting/semantic tags only. Every tag here is
  // non-scriptable and has no URL-injection surface. Intentionally NOT allowed:
  // iframe, object, embed, form, style, script, svg, and any event-handler attrs.
  allowedTags: [
    "p", "br", "strong", "em", "b", "i", "u", "s", "del", "ins",
    "sub", "sup", "small", "mark", "abbr",
    "code", "pre", "blockquote",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "dl", "dt", "dd",
    "a", "img", "figure", "figcaption",
    "table", "caption", "colgroup", "col", "thead", "tbody", "tr", "th", "td",
    "hr", "span", "div",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    abbr: ["title"],
    col: ["span"],
    colgroup: ["span"],
    "*": ["class"],
  },
  // Block javascript:/data: URIs in href and src
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    img: ["https"],
  },
  // `style` is not allowed, so no need to parse CSS — keeps postcss off the
  // hot path and documents the intent.
  parseStyleAttributes: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        // Enforce noopener/noreferrer on target=_blank (reverse tabnabbing)
        ...(attribs.target === "_blank" ? { rel: "noopener noreferrer" } : {}),
      },
    }),
    img: (tagName, attribs) => {
      const src = attribs.src ?? "";
      // Restrict image sources to the CDN or relative paths. Reject
      // protocol-relative URLs (//evil.com) — they start with "/" but resolve
      // to an external origin.
      const allowed =
        src.startsWith("https://img.beauteas.com/") ||
        (src.startsWith("/") && !src.startsWith("//"));
      if (!allowed) {
        const { src: _omit, ...rest } = attribs;
        return { tagName, attribs: rest };
      }
      return { tagName, attribs };
    },
  },
};

export function sanitizeBlogHtmlServer(html: string): string {
  return sanitizeHtml(html, RICH_HTML_OPTIONS);
}

// Alias used by CMS page writes — same allowlist as blog posts (rich text body).
export const sanitizePageHtmlServer = sanitizeBlogHtmlServer;
