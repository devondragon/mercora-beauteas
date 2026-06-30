"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Account error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h2 className="text-xl font-semibold text-text-primary mb-2">Something went wrong</h2>
      <p className="text-text-secondary mb-6 max-w-md">
        We couldn&apos;t load your account data. Please try again.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-md bg-primary-500 px-6 py-2 text-sm font-medium text-text-inverse hover:bg-primary-600 transition-colors"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-border-default px-6 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
