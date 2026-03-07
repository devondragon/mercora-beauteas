/**
 * Page Transformer
 *
 * Transforms Shopify CMS pages into Mercora page records for the D1 pages table.
 *
 * IMPORTANT: The pages table uses integer Unix timestamps (not ISO 8601 strings).
 * - published_at, created_at, updated_at are all INTEGER columns
 * - Must convert dates with Math.floor(new Date(date).getTime() / 1000)
 *
 * Pages use auto-increment integer ID, so we omit id from inserts.
 */

import type { ShopifyPage } from '../lib/types.js';

/** Mercora page record matching the actual pages table columns */
export interface PageRecord {
  title: string;
  slug: string;
  content: string;
  meta_title: string | null;
  meta_description: string | null;
  status: string;
  published_at: number | null; // Unix timestamp (integer)
  template: string;
  created_at: number; // Unix timestamp (integer)
  updated_at: number; // Unix timestamp (integer)
  version: number;
  show_in_nav: number; // SQLite boolean (0/1)
}

export interface PageTransformResult {
  records: PageRecord[];
  skipped: Array<{ record: ShopifyPage; reason: string }>;
  warnings: string[];
}

/**
 * Convert ISO 8601 date string to Unix timestamp (seconds).
 * Returns null if date string is invalid or not provided.
 */
function toUnixTimestamp(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return Math.floor(date.getTime() / 1000);
  } catch {
    return null;
  }
}

/**
 * Strip HTML tags from a string to extract plain text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Transform Shopify pages into Mercora page records.
 */
export function transformPages(
  pages: ShopifyPage[]
): PageTransformResult {
  const records: PageRecord[] = [];
  const skipped: Array<{ record: ShopifyPage; reason: string }> = [];
  const warnings: string[] = [];

  const now = Math.floor(Date.now() / 1000);

  for (const page of pages) {
    if (!page.title || !page.handle) {
      skipped.push({
        record: page,
        reason: 'Missing title or handle',
      });
      continue;
    }

    // Meta description: first 160 chars of stripped HTML body
    const plainText = stripHtml(page.body_html || '');
    const metaDescription = plainText.length > 160
      ? plainText.substring(0, 157) + '...'
      : plainText || null;

    // Timestamps -- Unix integer format for pages table
    const publishedAt = toUnixTimestamp(page.published_at);
    const createdAt = toUnixTimestamp(page.created_at) || now;
    const updatedAt = toUnixTimestamp(page.updated_at) || now;

    records.push({
      title: page.title,
      slug: page.handle,
      content: page.body_html || '',
      meta_title: page.title,
      meta_description: metaDescription,
      status: page.published_at ? 'published' : 'draft',
      published_at: publishedAt,
      template: 'default',
      created_at: createdAt,
      updated_at: updatedAt,
      version: 1,
      show_in_nav: 0, // false -- can be configured later in admin
    });
  }

  return { records, skipped, warnings };
}
