interface BlogPostContentProps {
  html: string;
}

// HTML is sanitized at write-time, so it is safe to render directly here as a
// server component (the body is in the SSR output, which is what BMC-122 fixes).
// Two layers gate every write: browser-side DOMPurify in BlogEditor (first-pass
// UX) and server-side sanitize-html in the model layer (authoritative gate,
// Workers-compatible). No client-side re-sanitization is needed.
export function BlogPostContent({ html }: BlogPostContentProps) {
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
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
