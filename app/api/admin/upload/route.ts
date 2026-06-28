import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { uploadToR2, getContentTypeFromFilename } from "@/lib/utils/r2";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/admin/upload
 *
 * General-purpose image upload used by the blog Novel editor.
 * Returns { ok: true, url: "/blog/{key}" } on success.
 *
 * Images are stored in the MEDIA R2 bucket under blog/{timestamp}-{uuid}.ext
 * and served via the beauteas-images.beauteas.com CDN domain.
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

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ ok: false, error: "Only image files are allowed" }, { status: 400 });
  }

  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    return NextResponse.json({ ok: false, error: "SVG files are not allowed" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ ok: false, error: "Image must be under 10MB" }, { status: 413 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const key = `blog/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  try {
    const env = process.env as unknown as { MEDIA: R2Bucket };
    if (!env.MEDIA) {
      return NextResponse.json({ ok: false, error: "Storage not configured" }, { status: 500 });
    }

    await uploadToR2(env.MEDIA, key, await file.arrayBuffer(), {
      contentType: file.type || getContentTypeFromFilename(key),
      customMetadata: { originalName: file.name, uploadType: "blog-editor" },
    });

    return NextResponse.json({ ok: true, url: `/${key}` });
  } catch {
    return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 500 });
  }
}
