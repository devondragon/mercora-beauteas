"use client";

import { useEffect } from "react";

// global-error replaces the root layout on a root-level crash, so it must
// render its own <html>/<body> and cannot rely on the layout's providers,
// fonts, or Tailwind classes. Styling is inlined with brand tokens so the
// fallback stays branded even when the app fully fails to render.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "5rem 1.5rem",
          textAlign: "center",
          backgroundColor: "#fdf8f6",
          color: "#222222",
          fontFamily: "Georgia, serif",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
          Something went wrong
        </h2>
        <p style={{ color: "#555555", maxWidth: "28rem", margin: "0 0 1.5rem" }}>
          We hit a snag while brewing BeauTeas. Please take a breath and try again.
        </p>
        {/* eslint-disable @next/next/no-html-link-for-pages --
            Use a plain <a>, not next/link: the Next.js router context cannot be
            assumed healthy in a root-layout crash, so a hard navigation is the
            reliable escape hatch. */}
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.375rem",
              border: "none",
              backgroundColor: "#cf8577",
              color: "#ffffff",
              padding: "0.5rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
          <a
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.375rem",
              border: "1px solid #e8d5cf",
              backgroundColor: "transparent",
              color: "#555555",
              padding: "0.5rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Go Home
          </a>
        </div>
        {/* eslint-enable @next/next/no-html-link-for-pages */}
      </body>
    </html>
  );
}
