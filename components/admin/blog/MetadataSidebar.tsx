"use client";
import { useState } from "react";
import { PanelRight, ChevronRight } from "lucide-react";
import { TagInput } from "./TagInput";
import { BlogImageUpload } from "./BlogImageUpload";

export interface BlogPostMetadata {
  title: string;
  slug: string;
  date: string;
  author: string;
  excerpt: string;
  tags: string[];
  cover_image_url: string;
  cover_image_alt: string;
  status: "draft" | "published";
  meta_title: string;
  meta_description: string;
}

interface MetadataSidebarProps {
  metadata: BlogPostMetadata;
  onChange: (m: BlogPostMetadata) => void;
}

const inputClass =
  "w-full rounded border border-border-default bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-secondary-500";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary">
      {children}
    </label>
  );
}

export function MetadataSidebar({ metadata, onChange }: MetadataSidebarProps) {
  const [open, setOpen] = useState(true);

  function update(partial: Partial<BlogPostMetadata>) {
    onChange({ ...metadata, ...partial });
  }

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-l border border-r-0 border-border-default bg-white text-text-secondary hover:text-text-primary"
          aria-label="Open metadata sidebar">
          <PanelRight className="h-5 w-5" />
        </button>
      )}

      {open && (
        <aside className="flex w-80 shrink-0 flex-col border-l border-border-default bg-white">
          <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
            <h2 className="text-sm font-semibold text-text-primary">Post Settings</h2>
            <button type="button" onClick={() => setOpen(false)}
              className="rounded p-1 text-text-secondary hover:bg-surface hover:text-text-primary"
              aria-label="Close sidebar">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div>
              <Label>Title</Label>
              <input type="text" value={metadata.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder="Post title" className={inputClass} />
            </div>

            <div>
              <Label>Slug</Label>
              <input type="text" value={metadata.slug}
                onChange={(e) => update({ slug: e.target.value })}
                placeholder="post-slug" className={inputClass} />
            </div>

            <div>
              <Label>Date</Label>
              <input type="date" value={metadata.date}
                onChange={(e) => update({ date: e.target.value })}
                className={inputClass} />
            </div>

            <div>
              <Label>Author</Label>
              <input type="text" value={metadata.author}
                onChange={(e) => update({ author: e.target.value })}
                placeholder="Author name" className={inputClass} />
            </div>

            <div>
              <Label>Excerpt</Label>
              <textarea value={metadata.excerpt}
                onChange={(e) => update({ excerpt: e.target.value })}
                rows={3} placeholder="Short excerpt..."
                className={inputClass + " resize-none"} />
            </div>

            <div>
              <Label>Tags</Label>
              <TagInput tags={metadata.tags} onChange={(tags) => update({ tags })} />
            </div>

            <div>
              <Label>Cover Image</Label>
              <BlogImageUpload
                imageUrl={metadata.cover_image_url}
                onChange={(url) => update({ cover_image_url: url, ...(url === "" ? { cover_image_alt: "" } : {}) })}
              />
              {metadata.cover_image_url && (
                <div className="mt-1.5">
                  <input type="text" value={metadata.cover_image_alt}
                    onChange={(e) => update({ cover_image_alt: e.target.value })}
                    placeholder="Describe the cover image..."
                    className={inputClass + " text-xs"} />
                </div>
              )}
            </div>

            <div>
              <Label>SEO Title</Label>
              <input type="text" value={metadata.meta_title}
                onChange={(e) => update({ meta_title: e.target.value })}
                placeholder="Leave blank to use post title" className={inputClass} />
            </div>

            <div>
              <Label>SEO Description</Label>
              <textarea value={metadata.meta_description}
                onChange={(e) => update({ meta_description: e.target.value })}
                rows={2} placeholder="Leave blank to use excerpt"
                className={inputClass + " resize-none"} />
            </div>

            <div>
              <Label>Status</Label>
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${
                metadata.status === "published"
                  ? "bg-state-success-bg text-state-success"
                  : "bg-state-warning-bg text-state-warning"
              }`}>
                {metadata.status}
              </span>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
