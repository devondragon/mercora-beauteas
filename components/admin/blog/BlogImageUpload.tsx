"use client";
import { useRef, useState, type DragEvent } from "react";
import { Upload, X, Loader2 } from "lucide-react";

interface BlogImageUploadProps {
  imageUrl: string;
  onChange: (url: string) => void;
  onAltText?: (alt: string) => void;
}

const MAX_SIZE = 10 * 1024 * 1024;

export function BlogImageUpload({ imageUrl, onChange, onAltText }: BlogImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError("");
    if (!file.type.startsWith("image/")) { setError("Only images allowed"); return; }
    if (file.size > MAX_SIZE) { setError("Max 10MB"); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const data = await res.json() as { ok?: boolean; url?: string; error?: string };
      if (data.ok && data.url) {
        onChange(data.url);
      } else {
        setError(data.error ?? "Upload failed");
      }
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleFiles(files: FileList | null) {
    const f = files?.[0];
    if (f) upload(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div>
      {imageUrl ? (
        <div className="relative">
          <div className="relative aspect-video overflow-hidden rounded border border-neutral-700">
            <img src={imageUrl} alt="Cover" className="h-full w-full object-cover" />
          </div>
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-1 top-1 rounded bg-black/70 p-1 text-white hover:bg-black"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed py-6 text-sm transition-colors ${
            dragging ? "border-amber-500 bg-amber-900/10" : "border-neutral-600 hover:border-neutral-500"
          }`}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-amber-400" />
          ) : (
            <>
              <Upload className="h-6 w-6 text-neutral-500" />
              <span className="text-neutral-400">Click or drop image</span>
            </>
          )}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
