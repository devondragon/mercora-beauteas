import sanitizeHtml from "sanitize-html";

// Works in Cloudflare Workers: sanitize-html uses htmlparser2 (pure JS, no DOM).
// Called at write-time in the model layer before HTML is persisted.
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
        // Restrict image sources to the CDN or relative paths
        if (!src.startsWith("https://beauteas-images.beauteas.com/") && !src.startsWith("/")) {
          const { src: _, ...rest } = attribs;
          return { tagName, attribs: rest };
        }
        return { tagName, attribs };
      },
    },
  });
}
