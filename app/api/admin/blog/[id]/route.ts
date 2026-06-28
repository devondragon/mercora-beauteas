import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { adminGetBlogPost, adminUpdateBlogPost, adminDeleteBlogPost } from "@/lib/models/blog";

interface Params { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: 401 });

  const { id } = await params;
  const post = await adminGetBlogPost(parseInt(id));
  if (!post) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true, data: post });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: 401 });

  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const post = await adminUpdateBlogPost(parseInt(id), {
    title: body.title as string | undefined,
    slug: body.slug as string | undefined,
    date: body.date as string | undefined,
    author: body.author as string | undefined,
    excerpt: body.excerpt as string | undefined,
    tags: body.tags as string[] | undefined,
    cover_image_url: body.cover_image_url as string | undefined,
    cover_image_alt: body.cover_image_alt as string | undefined,
    status: body.status as "draft" | "published" | undefined,
    tiptap_json: body.tiptap_json as string | undefined,
    html: body.html as string | undefined,
    meta_title: body.meta_title as string | undefined,
    meta_description: body.meta_description as string | undefined,
    updated_by: auth.userId ?? undefined,
  });
  if (!post) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true, data: post });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) return NextResponse.json({ success: false, error: auth.error }, { status: 401 });

  const { id } = await params;
  const deleted = await adminDeleteBlogPost(parseInt(id));
  if (!deleted) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
