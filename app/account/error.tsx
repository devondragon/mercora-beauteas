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
      <h2 className="text-xl font-semibold text-white mb-2">Something went wrong</h2>
      <p className="text-neutral-400 mb-6 max-w-md">
        We couldn&apos;t load your account data. Please try again.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-md bg-orange-500 px-6 py-2 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-neutral-600 px-6 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
