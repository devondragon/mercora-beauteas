import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const blog_categories = sqliteTable("blog_categories", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
}, (t) => ({
  slugIdx: index("blog_categories_slug_idx").on(t.slug),
}));

export const blog_posts = sqliteTable("blog_posts", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  date: text("date").notNull(),
  author: text("author").notNull().default("BeauTeas Team"),
  excerpt: text("excerpt"),
  tags: text("tags").notNull().default("[]"), // JSON array
  cover_image_url: text("cover_image_url"),
  cover_image_alt: text("cover_image_alt"),
  status: text("status").notNull().default("draft"),
  tiptap_json: text("tiptap_json"),
  html: text("html").notNull().default(""),
  reading_time: integer("reading_time").notNull().default(1),
  category_id: integer("category_id").references(() => blog_categories.id, { onDelete: "set null" }),
  meta_title: text("meta_title"),
  meta_description: text("meta_description"),
  published_at: integer("published_at"),
  created_at: integer("created_at").notNull().default(sql`(unixepoch())`),
  updated_at: integer("updated_at").notNull().default(sql`(unixepoch())`),
  created_by: text("created_by"),
  updated_by: text("updated_by"),
}, (t) => ({
  slugIdx: index("blog_posts_slug_idx").on(t.slug),
  statusIdx: index("blog_posts_status_idx").on(t.status),
  dateIdx: index("blog_posts_date_idx").on(t.date),
  categoryIdx: index("blog_posts_category_idx").on(t.category_id),
  publishedIdx: index("blog_posts_published_idx").on(t.published_at),
}));

export type BlogPostSelect = typeof blog_posts.$inferSelect;
export type BlogPostInsert = typeof blog_posts.$inferInsert;
export type BlogCategorySelect = typeof blog_categories.$inferSelect;
export type BlogCategoryInsert = typeof blog_categories.$inferInsert;
