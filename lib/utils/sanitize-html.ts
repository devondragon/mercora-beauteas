"use client";
// "use client" guards against accidental server-side import: isomorphic-dompurify
// falls back to jsdom off-browser, which does not run in Cloudflare Workers. For
// server-side sanitization use sanitize-html-server.ts instead.
import DOMPurify from "isomorphic-dompurify";

// Register the hook once at module load so it is never duplicated and never
// leaks if sanitize() throws (the prior add/remove-per-call pattern could).
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // Enforce noopener/noreferrer on target=_blank links (reverse tabnabbing)
  if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
    node.setAttribute("rel", "noopener noreferrer");
  }
  // Restrict image sources to the CDN or relative paths (block tracking pixels).
  // Reject protocol-relative URLs (//evil.com) — they start with "/" but resolve
  // to an external origin.
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") ?? "";
    const allowed =
      src.startsWith("https://beauteas-images.beauteas.com/") ||
      (src.startsWith("/") && !src.startsWith("//"));
    if (!allowed) {
      node.removeAttribute("src");
    }
  }
});

export function sanitizeBlogHtml(html: string): string {
  return DOMPurify.sanitize(html, {
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
}
