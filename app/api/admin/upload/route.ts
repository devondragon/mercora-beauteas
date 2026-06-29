import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { uploadToR2, getContentTypeFromFilename } from "@/lib/utils/r2";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/**
 * POST /api/admin/upload
 *
 * General-purpose image upload used by the blog Novel editor.
 * Returns { ok: true, url: "https://img.beauteas.com/blog/{key}" } on success.
 *
 * Images are stored in the MEDIA R2 bucket under blog/{timestamp}-{uuid}.ext
 * and served via the img.beauteas.com CDN domain.
 */
export async function POST(request: NextRequest) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Missing file field" }, { status: 400 });
  }

  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    return NextResponse.json({ ok: false, error: "Unsupported image type (allowed: JPEG, PNG, WebP, GIF, AVIF)" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ ok: false, error: "Image must be under 10MB" }, { status: 413 });
  }

  const key = `blog/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  try {
    const { env } = await getCloudflareContext({ async: true });
    if (!env.MEDIA) {
      return NextResponse.json({ ok: false, error: "Storage not configured" }, { status: 500 });
    }

    await uploadToR2(env.MEDIA, key, await file.arrayBuffer(), {
      contentType: file.type || getContentTypeFromFilename(key),
      customMetadata: { originalName: file.name, uploadType: "blog-editor" },
    });

    // Absolute CDN URL (matches IMAGE_CDN in lib/seo/metadata.ts). A relative
    // "/blog/..." URL would be routed to the blog [slug] page and 404.
    return NextResponse.json({ ok: true, url: `https://img.beauteas.com/${key}` });
  } catch {
    return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 500 });
  }
}
