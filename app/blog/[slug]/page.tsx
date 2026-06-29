import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { BlogPostContent } from "@/components/blog/BlogPostContent";
import { getPublishedBlogPost, getPublishedBlogPosts, getRelatedPosts } from "@/lib/models/blog";
import { SITE_NAME, BASE_URL } from "@/lib/seo/metadata";
import { formatDate } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedBlogPost(slug);
  if (!post) return {};

  const title = post.meta_title || post.title;
  const description = post.meta_description || post.excerpt || "";
  const imageUrl = post.cover_image_url
    ? post.cover_image_url.startsWith("/")
      ? `${BASE_URL}${post.cover_image_url}`
      : post.cover_image_url
    : undefined;

  return {
    title: `${title} | ${SITE_NAME}`,
    description,
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/blog/${slug}`,
      siteName: SITE_NAME,
      type: "article",
      publishedTime: post.published_at ? new Date(post.published_at * 1000).toISOString() : post.date,
      authors: [post.author],
      ...(imageUrl && { images: [{ url: imageUrl, alt: post.cover_image_alt ?? title }] }),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(imageUrl && { images: [imageUrl] }),
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const [post, allPosts] = await Promise.all([
    getPublishedBlogPost(slug),
    getPublishedBlogPosts(),
  ]);

  if (!post) notFound();

  const related = getRelatedPosts(allPosts, post.slug, post.tags, 3);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt ?? "",
    datePublished: post.published_at
      ? new Date(post.published_at * 1000).toISOString()
      : post.date,
    dateModified: new Date(post.updated_at * 1000).toISOString(),
    author: { "@type": "Person", name: post.author },
    publisher: { "@type": "Organization", name: SITE_NAME, url: BASE_URL },
    url: `${BASE_URL}/blog/${post.slug}`,
    ...(post.cover_image_url && {
      image: post.cover_image_url.startsWith("/")
        ? `${BASE_URL}${post.cover_image_url}`
        : post.cover_image_url,
    }),
  };

  return (
    <>
      {/* JSON-LD: JSON.stringify output is safe; replace </script> to prevent early tag close */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd).replace(/</g, "\\u003c") }}
      />

      <div className="min-h-screen bg-neutral-950 text-white">
        {/* Hero */}
        {post.cover_image_url && (
          <div className="relative h-64 md:h-96">
            <img
              src={post.cover_image_url}
              alt={post.cover_image_alt ?? post.title}
              className="h-full w-full object-cover"
              loading="eager"
            />
            <div className="absolute inset-0 bg-neutral-950/50" />
          </div>
        )}

        {/* Article */}
        <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
          <header className="mb-10">
            {post.tags.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {post.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/blog?tag=${encodeURIComponent(tag)}`}
                    className="rounded-full bg-amber-900/30 px-3 py-1 text-xs font-medium text-amber-400 hover:bg-amber-900/50"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            )}
            <h1 className="text-3xl font-bold leading-tight text-white md:text-4xl lg:text-5xl">
              {post.title}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-400">
              <span>{post.author}</span>
              <span className="hidden sm:inline">·</span>
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span className="hidden sm:inline">·</span>
              <span>{post.reading_time} min read</span>
            </div>
          </header>

          <BlogPostContent html={post.html} />
        </article>

        {/* Related posts */}
        {related.length > 0 && (
          <section className="border-t border-neutral-800 bg-neutral-900/50 py-12">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
              <h2 className="mb-8 text-xl font-semibold text-white">Related Posts</h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((rel) => (
                  <Link
                    key={rel.slug}
                    href={`/blog/${rel.slug}`}
                    className="group rounded-xl border border-neutral-700 bg-neutral-900 p-5 transition hover:border-amber-800/50"
                  >
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {rel.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="rounded-full bg-amber-900/20 px-2 py-0.5 text-xs text-amber-400">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <h3 className="font-medium text-white group-hover:text-amber-400">{rel.title}</h3>
                    <p className="mt-1 text-xs text-neutral-500">{formatDate(rel.date)} · {rel.reading_time} min</p>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Back to blog */}
        <div className="py-8 text-center">
          <Link href="/blog" className="text-sm text-amber-400 hover:text-amber-300">
            ← Back to Beauty Journal
          </Link>
        </div>
      </div>
    </>
  );
}
