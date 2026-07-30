/**
 * Scoped to /account deliberately. A loading.tsx creates a Suspense boundary
 * that commits a 200 before the page can notFound() (see app/layout.tsx) — safe
 * here because these routes are auth-gated, never indexed, and do not 404 on a
 * missing entity. Keep loading states in segments like this one rather than at
 * the root.
 */
export default function AccountLoading() {
  return (
    <div className="animate-pulse space-y-6">
      {/* Page title skeleton */}
      <div className="h-8 w-48 bg-surface-light rounded" />

      {/* Content cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white border border-border-default rounded-lg p-5 space-y-3"
          >
            <div className="h-4 w-24 bg-surface-light rounded" />
            <div className="h-6 w-32 bg-surface-light rounded" />
            <div className="h-3 w-full bg-surface-light/50 rounded" />
          </div>
        ))}
      </div>

      {/* Detail section skeleton */}
      <div className="bg-white border border-border-default rounded-lg p-5 space-y-4">
        <div className="h-4 w-36 bg-surface-light rounded" />
        <div className="space-y-2">
          <div className="h-3 w-full bg-surface-light/50 rounded" />
          <div className="h-3 w-3/4 bg-surface-light/50 rounded" />
          <div className="h-3 w-1/2 bg-surface-light/50 rounded" />
        </div>
      </div>
    </div>
  );
}
