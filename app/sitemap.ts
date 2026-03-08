/**
 * Dynamic Sitemap Generation
 *
 * Generates an XML sitemap from database content (products, categories, CMS pages).
 * Replaces the former static public/sitemap.xml so that new content is automatically
 * discoverable by search engines without manual XML edits.
 *
 * Next.js serves this at /sitemap.xml via the App Router metadata convention.
 */

import type { MetadataRoute } from "next";
import { listProducts, listCategories, getPublishedPages } from "@/lib/models";

const BASE_URL = "https://beauteas.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, pages] = await Promise.all([
    listProducts({ status: ["active"] }),
    listCategories({ status: "active" }),
    getPublishedPages(),
  ]);

  const homepage: MetadataRoute.Sitemap[number] = {
    url: `${BASE_URL}/`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: 1.0,
  };

  const categoryUrls: MetadataRoute.Sitemap = categories.map((c) => ({
    url: `${BASE_URL}/category/${
      typeof c.slug === "string"
        ? c.slug
        : typeof c.slug === "object" && c.slug !== null
          ? Object.values(c.slug)[0]
          : c.id
    }`,
    lastModified: c.updated_at ? new Date(c.updated_at) : new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.9,
  }));

  const productUrls: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${BASE_URL}/product/${typeof p.slug === "string" ? p.slug : p.id}`,
    lastModified: p.updated_at ? new Date(p.updated_at) : new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const pageUrls: MetadataRoute.Sitemap = pages.map((page) => ({
    url: `${BASE_URL}/${page.slug}`,
    lastModified: page.updated_at ? new Date(page.updated_at) : new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [homepage, ...categoryUrls, ...productUrls, ...pageUrls];
}
