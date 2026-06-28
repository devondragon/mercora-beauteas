import { Metadata } from "next";
import { notFound } from "next/navigation";
import { BlogEditor } from "@/components/admin/blog/BlogEditor";

export const metadata: Metadata = { title: "Edit Post | BeauTeas Admin" };

interface Props { params: Promise<{ id: string }> }

export default async function EditBlogPostPage({ params }: Props) {
  const { id } = await params;
  const postId = parseInt(id, 10);
  if (isNaN(postId)) notFound();
  return <BlogEditor postId={postId} />;
}
