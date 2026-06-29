"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus, Edit3, Trash2, Eye, EyeOff, Search, Loader2, FileText, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { BlogPostSummary } from "@/lib/models/blog";

function formatDate(ts: string | number): string {
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d.getTime())) return "—";
  // Render in UTC so date-only strings (YYYY-MM-DD) don't shift a day back for
  // viewers behind UTC (off-by-one).
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
      status === "published" ? "bg-green-900/40 text-green-400" : "bg-yellow-900/40 text-yellow-400"
    }`}>
      {status}
    </span>
  );
}

export function BlogManagement() {
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({ total: 0, published: 0, draft: 0 });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [postsRes, statsRes] = await Promise.all([
        fetch("/api/admin/blog"),
        fetch("/api/admin/blog?stats=true"),
      ]);
      const postsData = await postsRes.json() as { success: boolean; data: BlogPostSummary[] };
      const statsData = await statsRes.json() as { success: boolean; data: typeof stats };
      if (postsData.success) setPosts(postsData.data);
      if (statsData.success) setStats(statsData.data);
    } catch {
      setError("Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleStatus(post: BlogPostSummary) {
    const newStatus = post.status === "published" ? "draft" : "published";
    const res = await fetch(`/api/admin/blog/${post.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) { setError("Failed to update status"); return; }
    await load();
  }

  async function deletePost(post: BlogPostSummary) {
    if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/blog/${post.id}`, { method: "DELETE" });
    if (!res.ok) { setError("Failed to delete post"); return; }
    await load();
  }

  const filtered = posts.filter((p) =>
    !search || p.title.toLowerCase().includes(search.toLowerCase()) ||
    (p.excerpt ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {error && (
        <div className="mb-4 flex items-center justify-between rounded border border-red-800 bg-red-900/30 px-4 py-2 text-sm text-red-300">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} className="text-red-400 hover:text-red-200">✕</button>
        </div>
      )}
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Blog</h1>
          <p className="mt-0.5 text-sm text-neutral-400">
            {stats.total} total · {stats.published} published · {stats.draft} drafts
          </p>
        </div>
        <Link
          href="/admin/blog/new"
          className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
        >
          <Plus className="h-4 w-4" /> New Post
        </Link>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
        <input
          type="text"
          placeholder="Search posts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-900 py-2 pl-9 pr-4 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 text-neutral-500">
          <FileText className="h-8 w-8" />
          <p>{search ? "No posts match your search" : "No blog posts yet"}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900">
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3">Title</th>
                <th className="hidden px-4 py-3 md:table-cell">Date</th>
                <th className="hidden px-4 py-3 sm:table-cell">Status</th>
                <th className="hidden px-4 py-3 lg:table-cell">Tags</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800 bg-neutral-950">
              {filtered.map((post) => (
                <tr key={post.id} className="hover:bg-neutral-900/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{post.title}</div>
                    {post.excerpt && (
                      <div className="mt-0.5 line-clamp-1 text-xs text-neutral-500">{post.excerpt}</div>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-neutral-400 md:table-cell">
                    {formatDate(post.date)}
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <StatusBadge status={post.status} />
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {post.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {post.status === "published" && (
                        <a
                          href={`/blog/${post.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                          title="View live"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleStatus(post)}
                        className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                        title={post.status === "published" ? "Unpublish" : "Publish"}
                      >
                        {post.status === "published" ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                      <Link
                        href={`/admin/blog/${post.id}/edit`}
                        className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
                        title="Edit"
                      >
                        <Edit3 className="h-4 w-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => deletePost(post)}
                        className="rounded p-1.5 text-neutral-400 hover:bg-red-900/30 hover:text-red-400"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
