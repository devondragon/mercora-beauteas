import DOMPurify from "isomorphic-dompurify";

// DOMPurify requires the DOM and cannot run in Cloudflare Workers. Call this
// from "use client" components (browser context) before sending HTML to the API.
export function sanitizeBlogHtml(html: string): string {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    // Enforce noopener/noreferrer on target=_blank links (reverse tabnabbing)
    if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
      node.setAttribute("rel", "noopener noreferrer");
    }
    // Restrict image sources to the CDN or relative paths (block tracking pixels)
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      if (!src.startsWith("https://beauteas-images.beauteas.com/") && !src.startsWith("/")) {
        node.removeAttribute("src");
      }
    }
  });

  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "u", "s", "code", "pre", "blockquote",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "a", "img",
      "table", "thead", "tbody", "tr", "th", "td",
      "hr", "mark", "span", "div",
    ],
    ALLOWED_ATTR: ["href", "src", "alt", "class", "target", "rel", "width", "height"],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["onerror", "onload", "onclick"],
  });

  DOMPurify.removeHook("afterSanitizeAttributes");
  return clean;
}
