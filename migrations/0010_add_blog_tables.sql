-- Migration: Add blog system tables
-- Date: 2026-06-28
-- Description: blog_categories and blog_posts for the blog system
--   Content uses TipTap/Novel JSON + pre-rendered HTML (same format as BMCWebsite)

CREATE TABLE blog_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX blog_categories_slug_idx ON blog_categories(slug);

CREATE TABLE blog_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL, -- ISO date string YYYY-MM-DD
    author TEXT NOT NULL DEFAULT 'BeauTeas Team',
    excerpt TEXT,
    tags TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
    cover_image_url TEXT,
    cover_image_alt TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    tiptap_json TEXT, -- Novel/TipTap JSON content for the editor
    html TEXT NOT NULL DEFAULT '', -- Pre-rendered HTML for display
    reading_time INTEGER NOT NULL DEFAULT 1, -- estimated minutes
    category_id INTEGER REFERENCES blog_categories(id) ON DELETE SET NULL,
    meta_title TEXT,
    meta_description TEXT,
    published_at INTEGER, -- unix timestamp when first published
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    created_by TEXT,
    updated_by TEXT
);

CREATE INDEX blog_posts_slug_idx ON blog_posts(slug);
CREATE INDEX blog_posts_status_idx ON blog_posts(status);
CREATE INDEX blog_posts_date_idx ON blog_posts(date);
CREATE INDEX blog_posts_category_idx ON blog_posts(category_id);
CREATE INDEX blog_posts_published_idx ON blog_posts(published_at);
