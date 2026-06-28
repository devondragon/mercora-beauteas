import type { MetadataRoute } from "next";

const BASE_URL = "https://beauteas.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/category/",
        "/product/",
        "/about",
        "/philosophy",
        "/ingredients",
        "/brewing-guide",
        "/faq",
        "/contact",
        "/subscriptions",
        "/testimonials",
        "/sitemap.xml",
        // MCP server endpoints available for AI agent discovery
        "/api/mcp",
        "/api/mcp/schema",
      ],
      disallow: [
        "/checkout",
        "/orders",
        "/cart",
        "/account",
        "/api/",
        "/admin/",
        "/_next/",
        "/.well-known/",
        "/data/",
      ],
      crawlDelay: 1,
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
