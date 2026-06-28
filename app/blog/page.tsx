import type { Metadata } from "next";
import Link from "next/link";
import { getPublishedBlogPosts } from "@/lib/models/blog";
import { BlogTagFilter } from "@/components/blog/BlogTagFilter";
import { SITE_NAME, BASE_URL } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Beauty Journal | ${SITE_NAME}`,
  description: "Tea wisdom, skincare insights, and wellness rituals for your beauty from within journey.",
  openGraph: {
    title: `Beauty Journal | ${SITE_NAME}`,
    description: "Tea wisdom, skincare insights, and wellness rituals for your beauty from within journey.",
    url: `${BASE_URL}/blog`,
    siteName: SITE_NAME,
  },
};

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

export default async function BlogIndexPage() {
  const posts = await getPublishedBlogPosts();
  const tags = [...new Set(posts.flatMap((p) => p.tags))].sort();

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      {/* Header */}
      <section className="bg-gradient-to-b from-amber-950/30 to-neutral-950 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white md:text-5xl">Beauty Journal</h1>
        <p className="mx-auto mt-4 max-w-xl text-neutral-400">
          Tea wisdom, skincare insights, and wellness rituals for your beauty from within journey.
        </p>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
        <BlogTagFilter tags={tags} />

        {posts.length === 0 ? (
          <p className="py-20 text-center text-neutral-500">No posts yet. Check back soon!</p>
        ) : (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3" id="posts-grid">
            {posts.map((post) => (
              <article key={post.slug} data-post-tags={JSON.stringify(post.tags)}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="group flex h-full flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 transition hover:-translate-y-0.5 hover:border-amber-800/50 hover:shadow-lg"
                >
                  {post.cover_image_url && (
                    <div className="aspect-video overflow-hidden">
                      <img
                        src={post.cover_image_url}
                        alt={post.cover_image_alt ?? post.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-6">
                    {post.tags.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {post.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-amber-900/30 px-2.5 py-0.5 text-xs font-medium text-amber-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <h2 className="mb-2 flex-1 text-lg font-semibold text-white group-hover:text-amber-400">
                      {post.title}
                    </h2>
                    {post.excerpt && (
                      <p className="mb-4 line-clamp-3 text-sm text-neutral-400">{post.excerpt}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between text-xs text-neutral-500">
                      <time dateTime={post.date}>{formatDate(post.date)}</time>
                      <span>{post.reading_time} min read</span>
                    </div>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
