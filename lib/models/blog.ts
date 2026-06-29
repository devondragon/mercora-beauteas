import { cache } from "react";
import { eq, desc, and, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { getDbAsync } from "@/lib/db";
import { blog_posts, blog_categories, type BlogPostSelect, type BlogCategorySelect } from "@/lib/db/schema/blog";
import { sanitizeBlogHtmlServer } from "@/lib/utils/sanitize-html-server";

const summaryColumns = {
  id: blog_posts.id,
  title: blog_posts.title,
  slug: blog_posts.slug,
  date: blog_posts.date,
  author: blog_posts.author,
  excerpt: blog_posts.excerpt,
  tags: blog_posts.tags,
  cover_image_url: blog_posts.cover_image_url,
  cover_image_alt: blog_posts.cover_image_alt,
  status: blog_posts.status,
  reading_time: blog_posts.reading_time,
  published_at: blog_posts.published_at,
  created_at: blog_posts.created_at,
  updated_at: blog_posts.updated_at,
} as const;

export type BlogPostStatus = "draft" | "published";

export interface BlogPostSummary {
  id: number;
  title: string;
  slug: string;
  date: string;
  author: string;
  excerpt: string | null;
  tags: string[];
  cover_image_url: string | null;
  cover_image_alt: string | null;
  status: BlogPostStatus;
  reading_time: number;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface BlogPostFull extends BlogPostSummary {
  html: string;
  tiptap_json: string | null;
  category_id: number | null;
  meta_title: string | null;
  meta_description: string | null;
  created_by: string | null;
  updated_by: string | null;
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toSummary(
  row: Pick<
    BlogPostSelect,
    | "id" | "title" | "slug" | "date" | "author" | "excerpt" | "tags"
    | "cover_image_url" | "cover_image_alt" | "status" | "reading_time"
    | "published_at" | "created_at" | "updated_at"
  >
): BlogPostSummary {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    date: row.date,
    author: row.author,
    excerpt: row.excerpt ?? null,
    tags: parseTags(row.tags),
    cover_image_url: row.cover_image_url ?? null,
    cover_image_alt: row.cover_image_alt ?? null,
    status: (row.status as BlogPostStatus) ?? "draft",
    reading_time: row.reading_time ?? 1,
    published_at: row.published_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toFull(row: BlogPostSelect): BlogPostFull {
  return {
    ...toSummary(row),
    html: row.html ?? "",
    tiptap_json: row.tiptap_json ?? null,
    category_id: row.category_id ?? null,
    meta_title: row.meta_title ?? null,
    meta_description: row.meta_description ?? null,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
  };
}

export function calculateReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, "");
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(1, Math.ceil(words / 250));
}

export function getRelatedPosts(
  allPosts: BlogPostSummary[],
  currentSlug: string,
  currentTags: string[],
  limit = 3
): BlogPostSummary[] {
  const tagSet = new Set(currentTags);
  return allPosts
    .filter((p) => p.slug !== currentSlug && p.status === "published")
    .map((p) => ({ post: p, score: p.tags.filter((t) => tagSet.has(t)).length }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.post);
}

// ── Public queries ───────────────────────────────────────────────────────────

export async function getPublishedBlogPosts(): Promise<BlogPostSummary[]> {
  const db = await getDbAsync();
  const rows = await db
    .select(summaryColumns)
    .from(blog_posts)
    .where(eq(blog_posts.status, "published"))
    .orderBy(desc(blog_posts.date));
  return rows.map(toSummary);
}

export const getPublishedBlogPost = cache(async (slug: string): Promise<BlogPostFull | null> => {
  const db = await getDbAsync();
  const rows = await db
    .select()
    .from(blog_posts)
    .where(and(eq(blog_posts.slug, slug), eq(blog_posts.status, "published")))
    .limit(1);
  return rows[0] ? toFull(rows[0]) : null;
});

// ── Admin queries ────────────────────────────────────────────────────────────

export async function adminListBlogPosts(opts: {
  status?: BlogPostStatus;
  search?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<BlogPostSummary[]> {
  const db = await getDbAsync();

  const conditions: SQL[] = [];
  if (opts.status) conditions.push(eq(blog_posts.status, opts.status));
  if (opts.search) {
    conditions.push(
      or(like(blog_posts.title, `%${opts.search}%`), like(blog_posts.excerpt, `%${opts.search}%`))!
    );
  }

  let q = db.select(summaryColumns).from(blog_posts).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  q = q.orderBy(desc(blog_posts.updated_at));
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.offset) q = q.offset(opts.offset);

  const rows = await q;
  return rows.map(toSummary);
}

export async function adminGetBlogPost(id: number): Promise<BlogPostFull | null> {
  const db = await getDbAsync();
  const rows = await db.select().from(blog_posts).where(eq(blog_posts.id, id)).limit(1);
  return rows[0] ? toFull(rows[0]) : null;
}

export async function adminGetBlogPostBySlug(slug: string): Promise<BlogPostFull | null> {
  const db = await getDbAsync();
  const rows = await db.select().from(blog_posts).where(eq(blog_posts.slug, slug)).limit(1);
  return rows[0] ? toFull(rows[0]) : null;
}

export interface BlogPostInput {
  title: string;
  slug: string;
  date: string;
  author: string;
  excerpt?: string;
  tags?: string[];
  cover_image_url?: string;
  cover_image_alt?: string;
  status?: BlogPostStatus;
  tiptap_json?: string;
  html?: string;
  category_id?: number | null;
  meta_title?: string;
  meta_description?: string;
  created_by?: string;
  updated_by?: string;
}

export async function adminCreateBlogPost(input: BlogPostInput): Promise<BlogPostFull> {
  const db = await getDbAsync();
  const html = sanitizeBlogHtmlServer(input.html ?? "");
  const reading_time = calculateReadingTime(html);
  const now = Math.floor(Date.now() / 1000);
  const published_at = input.status === "published" ? now : null;

  const result = await db.insert(blog_posts).values({
    title: input.title,
    slug: input.slug,
    date: input.date,
    author: input.author,
    excerpt: input.excerpt ?? null,
    tags: JSON.stringify(Array.isArray(input.tags) ? input.tags : []),
    cover_image_url: input.cover_image_url ?? null,
    cover_image_alt: input.cover_image_alt ?? null,
    status: input.status ?? "draft",
    tiptap_json: input.tiptap_json ?? null,
    html,
    reading_time,
    category_id: input.category_id ?? null,
    meta_title: input.meta_title ?? null,
    meta_description: input.meta_description ?? null,
    published_at,
    created_at: now,
    updated_at: now,
    created_by: input.created_by ?? null,
    updated_by: input.updated_by ?? null,
  }).returning();

  return toFull(result[0]);
}

export async function adminUpdateBlogPost(id: number, input: Partial<BlogPostInput>): Promise<BlogPostFull | null> {
  const db = await getDbAsync();
  const now = Math.floor(Date.now() / 1000);

  const existing = await adminGetBlogPost(id);
  if (!existing) return null;

  // Only sanitize + recompute reading_time when the body is actually changing;
  // metadata-only updates (status toggle, tag edit) skip the htmlparser2 pass and
  // leave the stored html/reading_time untouched.
  const html = input.html !== undefined ? sanitizeBlogHtmlServer(input.html) : undefined;
  const reading_time = html !== undefined ? calculateReadingTime(html) : undefined;

  // Set published_at the first time a post is published; preserve it thereafter
  // (so unpublish → republish keeps the original publish date).
  let published_at = existing.published_at;
  if (input.status === "published" && !published_at) {
    published_at = now;
  }

  const updated = await db
    .update(blog_posts)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.slug !== undefined && { slug: input.slug }),
      ...(input.date !== undefined && { date: input.date }),
      ...(input.author !== undefined && { author: input.author }),
      ...(input.excerpt !== undefined && { excerpt: input.excerpt }),
      ...(input.tags !== undefined && { tags: JSON.stringify(Array.isArray(input.tags) ? input.tags : []) }),
      ...(input.cover_image_url !== undefined && { cover_image_url: input.cover_image_url }),
      ...(input.cover_image_alt !== undefined && { cover_image_alt: input.cover_image_alt }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.tiptap_json !== undefined && { tiptap_json: input.tiptap_json }),
      ...(html !== undefined && { html, reading_time }),
      ...(input.category_id !== undefined && { category_id: input.category_id }),
      ...(input.meta_title !== undefined && { meta_title: input.meta_title }),
      ...(input.meta_description !== undefined && { meta_description: input.meta_description }),
      published_at,
      updated_at: now,
      ...(input.updated_by !== undefined && { updated_by: input.updated_by }),
    })
    .where(eq(blog_posts.id, id))
    .returning();

  return updated[0] ? toFull(updated[0]) : null;
}

export async function adminDeleteBlogPost(id: number): Promise<boolean> {
  const db = await getDbAsync();
  const result = await db.delete(blog_posts).where(eq(blog_posts.id, id)).returning();
  return result.length > 0;
}

// ── Blog stats ───────────────────────────────────────────────────────────────

export async function getBlogStats(): Promise<{ total: number; published: number; draft: number }> {
  const db = await getDbAsync();
  const rows = await db
    .select({ status: blog_posts.status, count: sql<number>`count(*)` })
    .from(blog_posts)
    .groupBy(blog_posts.status);

  let total = 0, published = 0, draft = 0;
  for (const row of rows) {
    total += Number(row.count);
    if (row.status === "published") published = Number(row.count);
    else draft += Number(row.count);
  }
  return { total, published, draft };
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function getBlogCategories(): Promise<BlogCategorySelect[]> {
  const db = await getDbAsync();
  return db.select().from(blog_categories).orderBy(blog_categories.name);
}
