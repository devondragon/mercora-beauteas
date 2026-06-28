import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { adminListBlogPosts, adminCreateBlogPost, getBlogStats } from "@/lib/models/blog";

export async function GET(request: NextRequest) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: 401 });

  const { searchParams } = new URL(request.url);
  if (searchParams.get("stats") === "true") {
    const stats = await getBlogStats();
    return NextResponse.json({ success: true, data: stats });
  }

  const posts = await adminListBlogPosts({
    status: searchParams.get("status") as "draft" | "published" | undefined,
    search: searchParams.get("search") ?? undefined,
    limit: searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : undefined,
    offset: searchParams.get("offset") ? parseInt(searchParams.get("offset")!) : undefined,
  });
  return NextResponse.json({ success: true, data: posts });
}

export async function POST(request: NextRequest) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: 401 });

  const body = await request.json() as Record<string, unknown>;
  if (!body.title || !body.slug) {
    return NextResponse.json({ success: false, error: "title and slug are required" }, { status: 400 });
  }

  const post = await adminCreateBlogPost({
    title: body.title as string,
    slug: body.slug as string,
    date: (body.date as string) ?? new Date().toISOString().slice(0, 10),
    author: (body.author as string) ?? "BeauTeas Team",
    excerpt: body.excerpt as string | undefined,
    tags: body.tags as string[] | undefined,
    cover_image_url: body.cover_image_url as string | undefined,
    cover_image_alt: body.cover_image_alt as string | undefined,
    status: body.status as "draft" | "published" | undefined,
    tiptap_json: body.tiptap_json as string | undefined,
    html: body.html as string | undefined,
    meta_title: body.meta_title as string | undefined,
    meta_description: body.meta_description as string | undefined,
    created_by: auth.userId ?? undefined,
    updated_by: auth.userId ?? undefined,
  });
  return NextResponse.json({ success: true, data: post }, { status: 201 });
}
