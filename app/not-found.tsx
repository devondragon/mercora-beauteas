import Link from "next/link";

export default function NotFound() {
  return (
    <main className="px-4 py-24 sm:py-32 text-center max-w-2xl mx-auto">
      <p className="text-sm font-semibold uppercase tracking-widest text-secondary-600 mb-4">404 — Page not found</p>
      <h1 className="text-3xl sm:text-4xl font-serif font-bold text-text-primary mb-4">This page has steeped away</h1>
      <p className="text-text-secondary text-base sm:text-lg mb-8">
        We couldn&apos;t find the page you were looking for. Let&apos;s get you back to something soothing.
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link href="/" className="px-5 py-3 rounded font-semibold bg-primary-500 text-text-inverse hover:bg-primary-600 transition">Back home</Link>
        <Link href="/category/clearly-calendula" className="px-5 py-3 rounded font-semibold border border-secondary-400 text-secondary-600 hover:bg-secondary-400 hover:text-text-inverse transition">Shop teas</Link>
      </div>
    </main>
  );
}
