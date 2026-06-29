import sanitizeHtml from "sanitize-html";

// Works in Cloudflare Workers: sanitize-html uses htmlparser2 (pure JS, no DOM).
// Called at write-time in the model layer before HTML is persisted — this is the
// authoritative security gate (browser-side DOMPurify is first-pass UX only).
//
// This core module has NO `server-only` guard so plain-Node ops scripts (e.g.
// scripts/sanitize-blog-html.ts run via tsx) can reuse it. App code must import
// from ./sanitize-html-server instead, which adds the bundle guard.
export function sanitizeBlogHtmlServer(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "strong", "em", "u", "s", "code", "pre", "blockquote",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "a", "img",
      "table", "thead", "tbody", "tr", "th", "td",
      "hr", "mark", "span", "div",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height"],
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
          src.startsWith("https://beauteas-images.beauteas.com/") ||
          (src.startsWith("/") && !src.startsWith("//"));
        if (!allowed) {
          const { src: _omit, ...rest } = attribs;
          return { tagName, attribs: rest };
        }
        return { tagName, attribs };
      },
    },
  });
}
