/**
 * === R2 Media Route ===
 *
 * Same-origin proxy that streams objects from the MEDIA R2 bucket. Lets any
 * environment serve product/category images without a public bucket URL or a
 * live custom domain — used as the image host wherever NEXT_PUBLIC_IMAGE_CDN is
 * not set (e.g. the dev Worker). Production points the image loader at the
 * Cloudflare Images CDN domain instead, so this route is the dev/fallback path.
 *
 * Example: GET /media/products/clearly-calendula-morning.jpg
 *   → MEDIA.get("products/clearly-calendula-morning.jpg")
 */

import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";

interface RouteContext {
  params: Promise<{ key: string[] }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { key } = await params;
  const objectKey = (key ?? []).map((segment) => decodeURIComponent(segment)).join("/");

  if (!objectKey) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { env } = await getCloudflareContext({ async: true });
  const bucket = env.MEDIA;
  if (!bucket) {
    return new NextResponse("Media bucket not configured", { status: 500 });
  }

  const object = await bucket.get(objectKey);
  if (!object) {
    return new NextResponse("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Image content is immutable per key (handles are stable); cache aggressively.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");

  return new NextResponse(object.body as ReadableStream, { headers });
}
