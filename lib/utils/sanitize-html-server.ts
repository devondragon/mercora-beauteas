import "server-only";

// Server-app entry point for blog HTML sanitization. The `server-only` import
// guards against bundling sanitize-html + postcss into the client. The actual
// implementation lives in ./sanitize-html-core (unguarded) so ops scripts can
// reuse it; all Next.js app code (model layer, route handlers) imports here.
export { sanitizeBlogHtmlServer } from "./sanitize-html-core";
