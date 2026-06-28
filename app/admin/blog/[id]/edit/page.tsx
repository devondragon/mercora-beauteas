import { Metadata } from "next";
import { BlogEditor } from "@/components/admin/blog/BlogEditor";

export const metadata: Metadata = { title: "Edit Post | BeauTeas Admin" };

interface Props { params: Promise<{ id: string }> }

export default async function EditBlogPostPage({ params }: Props) {
  const { id } = await params;
  return <BlogEditor postId={parseInt(id)} />;
}
