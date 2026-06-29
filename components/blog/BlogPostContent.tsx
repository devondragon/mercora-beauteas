"use client";
import DOMPurify from "isomorphic-dompurify";

interface BlogPostContentProps {
  html: string;
}

export function BlogPostContent({ html }: BlogPostContentProps) {
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
    // Prevent javascript: links and data: URIs in href/src
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["onerror", "onload", "onclick"],
  });

  DOMPurify.removeHook("afterSanitizeAttributes");

  return (
    <div
      className="prose prose-invert prose-lg max-w-none
        prose-headings:text-white prose-headings:font-bold
        prose-p:text-neutral-200
        prose-a:text-amber-400 prose-a:no-underline hover:prose-a:underline
        prose-strong:text-white
        prose-code:text-amber-300 prose-code:bg-neutral-800 prose-code:px-1 prose-code:rounded
        prose-pre:bg-neutral-800 prose-pre:border prose-pre:border-neutral-700
        prose-blockquote:border-amber-600 prose-blockquote:text-neutral-300
        prose-img:rounded-lg prose-img:my-6
        prose-hr:border-neutral-700
        prose-table:border-collapse
        prose-th:border prose-th:border-neutral-700 prose-th:bg-neutral-800 prose-th:px-3 prose-th:py-2
        prose-td:border prose-td:border-neutral-700 prose-td:px-3 prose-td:py-2"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
