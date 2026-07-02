import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { uploadToR2 } from "@/lib/utils/r2";
import { EXT_BY_MIME, matchesImageSignature } from "@/lib/utils/image-signature";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

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

  // Validate file type against the shared MIME allowlist. file.type is
  // client-supplied, so the extension is derived from the validated MIME type
  // here, never from the attacker-controlled file.name.
  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    return NextResponse.json({ ok: false, error: "Unsupported image type (allowed: JPEG, PNG, WebP)" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ ok: false, error: "Image must be under 10MB" }, { status: 413 });
  }

  const arrayBuffer = await file.arrayBuffer();

  // Verify the file's actual leading bytes match the declared MIME type
  // (magic-byte check) — file.type alone is attacker-controlled and cannot be
  // trusted as the object's Content-Type.
  if (!matchesImageSignature(new Uint8Array(arrayBuffer), file.type)) {
    return NextResponse.json({ ok: false, error: "File content does not match the declared image type." }, { status: 400 });
  }

  // Normalize the non-standard "image/jpg" alias to standard "image/jpeg"
  // before it's stored as the object's Content-Type.
  const storedContentType = file.type === "image/jpg" ? "image/jpeg" : file.type;

  const key = `blog/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  try {
    const { env } = await getCloudflareContext({ async: true });
    if (!env.MEDIA) {
      return NextResponse.json({ ok: false, error: "Storage not configured" }, { status: 500 });
    }

    await uploadToR2(env.MEDIA, key, arrayBuffer, {
      contentType: storedContentType,
      customMetadata: { originalName: file.name, uploadType: "blog-editor" },
    });

    // Absolute CDN URL (matches IMAGE_CDN in lib/seo/metadata.ts). A relative
    // "/blog/..." URL would be routed to the blog [slug] page and 404.
    return NextResponse.json({ ok: true, url: `https://img.beauteas.com/${key}` });
  } catch {
    return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 500 });
  }
}
