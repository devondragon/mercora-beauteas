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
        <button
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
      </body>
    </html>
  );
}
