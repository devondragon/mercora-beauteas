"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  EditorRoot,
  EditorContent,
  EditorCommand,
  EditorCommandList,
  EditorCommandItem,
  EditorCommandEmpty,
  Command,
  type JSONContent,
  createImageUpload,
  handleImageDrop,
  handleImagePaste,
  handleCommandNavigation,
  createSuggestionItems,
  renderItems,
} from "novel";
import {
  Heading1, Heading2, Heading3, List, ListOrdered, TextQuote, Code, Image as ImageIcon,
  Save, Send, Eye, Trash2, Loader2, ArrowLeft, Table as TableIcon,
} from "lucide-react";
import { extensions } from "./extensions";
import { MetadataSidebar, type BlogPostMetadata } from "./MetadataSidebar";
import { EditorFormatToolbar } from "./EditorFormatToolbar";
import { EditorFooter } from "./EditorFooter";
import { promptForLink } from "./editorLinks";

function generateSlug(title: string): string {
  return title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultMetadata(): BlogPostMetadata {
  return {
    title: "", slug: "", date: todayDate(), author: "BeauTeas Team",
    excerpt: "", tags: [], cover_image_url: "", cover_image_alt: "",
    status: "draft", meta_title: "", meta_description: "",
  };
}

const IMAGE_UPLOAD_ERROR = "beauteas:blog-upload-error";

function dispatchUploadError(msg: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(IMAGE_UPLOAD_ERROR, { detail: msg }));
}

const uploadFn = createImageUpload({
  onUpload: async (file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: form });
    if (!res.ok) {
      const msg = `Upload failed (${res.status})`;
      dispatchUploadError(msg);
      throw new Error(msg);
    }
    const data = await res.json() as { ok?: boolean; url?: string; error?: string };
    if (!data.ok || !data.url) {
      const msg = data.error ?? "Upload failed";
      dispatchUploadError(msg);
      throw new Error(msg);
    }
    return data.url;
  },
  validateFn: (file: File) => {
    if (!file.type.startsWith("image/")) { dispatchUploadError("Only images allowed"); return false; }
    if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) { dispatchUploadError("SVG files are not allowed"); return false; }
    if (file.size > 10 * 1024 * 1024) { dispatchUploadError("Max 10MB"); return false; }
    return true;
  },
});

function safeUploadFn(file: File, view: import("@tiptap/pm/view").EditorView, pos: number) {
  const max = Math.max(0, view.state.doc.content.size - 1);
  uploadFn(file, view, Math.min(Math.max(pos, 0), max));
}

const suggestionItems = createSuggestionItems([
  { title: "Heading 1", description: "Large heading", searchTerms: ["h1"], icon: <Heading1 className="h-5 w-5" />,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run() },
  { title: "Heading 2", description: "Medium heading", searchTerms: ["h2"], icon: <Heading2 className="h-5 w-5" />,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run() },
  { title: "Heading 3", description: "Small heading", searchTerms: ["h3"], icon: <Heading3 className="h-5 w-5" />,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run() },
  { title: "Bullet List", description: "Unordered list", searchTerms: ["ul", "bullet"], icon: <List className="h-5 w-5" />,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
  { title: "Numbered List", description: "Ordered list", searchTerms: ["ol", "number"], icon: <ListOrdered className="h-5 w-5" />,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
  { title: "Blockquote", description: "Quotation", searchTerms: ["quote"], icon: <TextQuote className="h-5 w-5" />,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run() },
  { title: "Code Block", description: "Syntax-highlighted code", searchTerms: ["code"], icon: <Code className="h-5 w-5" />,
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run() },
  { title: "Image", description: "Upload an image", searchTerms: ["image", "img"], icon: <ImageIcon className="h-5 w-5" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*";
      input.style.cssText = "position:fixed;left:-9999px";
      input.onchange = () => {
        const f = input.files?.[0];
        if (f) safeUploadFn(f, editor.view, editor.view.state.selection.from);
        input.remove();
      };
      input.oncancel = () => input.remove();
      document.body.appendChild(input); input.click();
    }},
  { title: "Table", description: "3×3 table", searchTerms: ["table"], icon: <TableIcon className="h-5 w-5" />,
    command: ({ editor, range }) => (editor.chain().focus().deleteRange(range) as any).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
]);

const slashCommand = Command.configure({ suggestion: { items: () => suggestionItems, render: renderItems } });
const editorExtensions = [...extensions, slashCommand];

interface BlogEditorProps {
  postId?: number;
}

export function BlogEditor({ postId }: BlogEditorProps) {
  const [metadata, setMetadata] = useState<BlogPostMetadata>(defaultMetadata());
  const [content, setContent] = useState<JSONContent | undefined>(undefined);
  const [loading, setLoading] = useState(!!postId);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [slugLocked, setSlugLocked] = useState(!!postId);
  const [editorInstance, setEditorInstance] = useState<any>(null);
  const editorRef = useRef<any>(null);

  const flash = useCallback((msg: string, ms = 3000) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(""), ms);
  }, []);

  useEffect(() => {
    function onError(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string") flash(detail, 6000);
    }
    window.addEventListener(IMAGE_UPLOAD_ERROR, onError);
    return () => window.removeEventListener(IMAGE_UPLOAD_ERROR, onError);
  }, [flash]);

  useEffect(() => {
    if (!editorInstance) return;
    const dom = editorInstance.view?.dom as HTMLElement | undefined;
    if (!dom) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); promptForLink(editorInstance);
      }
    }
    dom.addEventListener("keydown", onKeyDown);
    return () => dom.removeEventListener("keydown", onKeyDown);
  }, [editorInstance]);

  useEffect(() => {
    if (!postId) return;
    (async () => {
      try {
        const res = await fetch(`/api/admin/blog/${postId}`);
        if (!res.ok) { flash("Failed to load post"); setLoading(false); return; }
        const data = await res.json() as { success: boolean; data?: any };
        if (data.success && data.data) {
          const post = data.data;
          setMetadata({
            title: post.title ?? "",
            slug: post.slug ?? "",
            date: post.date ?? todayDate(),
            author: post.author ?? "BeauTeas Team",
            excerpt: post.excerpt ?? "",
            tags: post.tags ?? [],
            cover_image_url: post.cover_image_url ?? "",
            cover_image_alt: post.cover_image_alt ?? "",
            status: post.status ?? "draft",
            meta_title: post.meta_title ?? "",
            meta_description: post.meta_description ?? "",
          });
          if (post.tiptap_json) {
            try { setContent(JSON.parse(post.tiptap_json)); } catch { /* ignore */ }
          }
        } else {
          flash("Failed to load post");
        }
      } catch {
        flash("Failed to load post");
      } finally {
        setLoading(false);
      }
    })();
  }, [postId, flash]);

  function handleMetadataChange(updated: BlogPostMetadata) {
    if (!slugLocked && updated.title !== metadata.title) {
      updated = { ...updated, slug: generateSlug(updated.title) };
    }
    setMetadata(updated);
  }

  async function handleSave() {
    const editor = editorRef.current;
    if (!metadata.slug) { flash("Slug is required"); return; }
    setSaving(true);
    try {
      const body = {
        ...metadata,
        tiptap_json: editor ? JSON.stringify(editor.getJSON()) : null,
        html: editor ? editor.getHTML() : "",
        status: metadata.status,
      };
      const url = postId ? `/api/admin/blog/${postId}` : "/api/admin/blog";
      const method = postId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json() as { success: boolean; data?: any; error?: string };
      if (data.success) {
        setSlugLocked(true);
        flash("Saved");
        if (!postId && data.data?.id) {
          window.location.href = `/admin/blog/${data.data.id}/edit`;
        }
      } else {
        flash(data.error ?? "Save failed");
      }
    } catch {
      flash("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublishToggle() {
    if (!postId) { flash("Save the post first"); return; }
    const action = metadata.status === "published" ? "draft" : "published";
    setSaving(true);
    try {
      const editor = editorRef.current;
      const body = {
        ...metadata,
        tiptap_json: editor ? JSON.stringify(editor.getJSON()) : null,
        html: editor ? editor.getHTML() : "",
        status: action,
      };
      const res = await fetch(`/api/admin/blog/${postId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json() as { success: boolean; data?: any; error?: string };
      if (data.success) {
        setMetadata((prev) => ({ ...prev, status: action }));
        flash(action === "published" ? "Published!" : "Moved to draft");
      } else {
        flash(data.error ?? "Failed");
      }
    } catch {
      flash("Failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!postId) return;
    if (!window.confirm("Delete this post permanently?")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/blog/${postId}`, { method: "DELETE" });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        window.location.href = "/admin/blog";
      } else {
        flash(data.error ?? "Delete failed");
      }
    } catch {
      flash("Delete failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4 py-2">
        <div className="flex items-center gap-2">
          <Link href="/admin/blog" className="flex items-center gap-1 rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Blog
          </Link>
          <span className="text-sm text-neutral-500">{metadata.slug || "new post"}</span>
        </div>
        <div className="flex items-center gap-2">
          {statusMsg && <span className="mr-2 text-sm text-amber-400">{statusMsg}</span>}
          <button type="button" onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
          <button type="button" onClick={handlePublishToggle} disabled={saving}
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              metadata.status === "published"
                ? "bg-yellow-700/30 text-yellow-400 hover:bg-yellow-700/50"
                : "bg-amber-600 text-white hover:bg-amber-500"
            }`}>
            <Send className="h-4 w-4" />
            {metadata.status === "published" ? "Unpublish" : "Publish"}
          </button>
          {postId && (
            <button type="button" onClick={handleDelete} disabled={saving}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/30 disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
        </div>
      </div>

      {/* Editor + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden bg-neutral-950">
          <EditorFormatToolbar editor={editorInstance} />
          <div className="flex-1 overflow-y-auto px-8 py-6">
            <EditorRoot>
              <EditorContent
                extensions={editorExtensions}
                initialContent={content}
                className="prose prose-invert prose-lg max-w-full focus:outline-none"
                editorProps={{
                  handleDOMEvents: { keydown: (_view, event) => handleCommandNavigation(event) },
                  handlePaste: (view, event) => handleImagePaste(view, event, safeUploadFn),
                  handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, safeUploadFn),
                  attributes: { class: "prose prose-invert prose-lg max-w-full min-h-[500px] focus:outline-none" },
                }}
                onCreate={({ editor }) => {
                  editorRef.current = editor;
                  setTimeout(() => setEditorInstance(editor), 0);
                }}
                onUpdate={({ editor }) => {
                  editorRef.current = editor;
                  setEditorInstance(editor);
                  setContent(editor.getJSON());
                }}
              >
                <EditorCommand className="z-50 w-72 rounded-lg border border-neutral-700 bg-neutral-800 p-1 shadow-xl">
                  <EditorCommandEmpty className="px-3 py-2 text-sm text-neutral-500">No results</EditorCommandEmpty>
                  <EditorCommandList>
                    {suggestionItems.map((item) => (
                      <EditorCommandItem key={item.title} value={item.title}
                        onCommand={(val) => item.command?.(val)}
                        className="flex items-center gap-3 rounded px-3 py-2 text-sm text-white hover:bg-neutral-700 aria-selected:bg-neutral-700">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-neutral-600 bg-neutral-900 text-amber-400">
                          {item.icon}
                        </span>
                        <div>
                          <p className="font-medium">{item.title}</p>
                          <p className="text-xs text-neutral-500">{item.description}</p>
                        </div>
                      </EditorCommandItem>
                    ))}
                  </EditorCommandList>
                </EditorCommand>
              </EditorContent>
            </EditorRoot>
          </div>
          <EditorFooter editor={editorInstance} />
        </div>
        <MetadataSidebar metadata={metadata} onChange={handleMetadataChange} />
      </div>
    </div>
  );
}
