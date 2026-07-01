import { Metadata } from "next";
import { BlogManagement } from "./BlogManagement";

export const metadata: Metadata = { title: "Blog – Admin" };

export default function AdminBlogPage() {
  return <BlogManagement />;
}
