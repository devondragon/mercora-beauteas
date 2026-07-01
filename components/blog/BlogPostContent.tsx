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
      className="prose prose-lg max-w-none
        prose-headings:text-text-primary prose-headings:font-bold
        prose-p:text-text-secondary
        prose-a:text-secondary-600 prose-a:no-underline hover:prose-a:underline
        prose-strong:text-text-primary
        prose-code:text-secondary-600 prose-code:bg-surface prose-code:px-1 prose-code:rounded
        prose-pre:bg-surface prose-pre:border prose-pre:border-border-default
        prose-blockquote:border-secondary-400 prose-blockquote:text-text-secondary
        prose-img:rounded-lg prose-img:my-6
        prose-hr:border-border-default
        prose-table:border-collapse
        prose-th:border prose-th:border-border-default prose-th:bg-surface prose-th:px-3 prose-th:py-2
        prose-td:border prose-td:border-border-default prose-td:px-3 prose-td:py-2"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
