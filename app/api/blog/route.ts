import { NextResponse } from "next/server";
import { getPublishedBlogPosts } from "@/lib/models/blog";

export const dynamic = "force-dynamic";

export async function GET() {
  const posts = await getPublishedBlogPosts();
  return NextResponse.json({ success: true, data: posts });
}
