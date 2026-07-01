import { Metadata } from "next";
import { BlogEditor } from "@/components/admin/blog/BlogEditor";

export const metadata: Metadata = { title: "New Post – Admin" };

export default function NewBlogPostPage() {
  return <BlogEditor />;
}
