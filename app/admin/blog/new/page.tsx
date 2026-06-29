import { Metadata } from "next";
import { BlogEditor } from "@/components/admin/blog/BlogEditor";

export const metadata: Metadata = { title: "New Post | BeauTeas Admin" };

export default function NewBlogPostPage() {
  return <BlogEditor />;
}
