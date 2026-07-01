"use client";
import { useState, type KeyboardEvent, type ChangeEvent } from "react";
import { X } from "lucide-react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function TagInput({ tags, onChange }: TagInputProps) {
  const [input, setInput] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setInput("");
  }

  function removeTag(i: number) {
    onChange(tags.filter((_, j) => j !== i));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(input); }
    if (e.key === "Backspace" && !input && tags.length > 0) removeTag(tags.length - 1);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v.includes(",")) { addTag(v.replace(",", "")); } else { setInput(v); }
  }

  return (
    <div className="flex flex-wrap gap-1.5 rounded border border-border-default bg-white p-2 focus-within:ring-1 focus-within:ring-secondary-500">
      {tags.map((tag, i) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-secondary-400/20 px-2.5 py-0.5 text-sm text-secondary-600">
          {tag}
          <button type="button" onClick={() => removeTag(i)} className="ml-0.5 rounded-full p-0.5 hover:bg-secondary-400/30" aria-label={`Remove ${tag}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? "Add tags..." : ""}
        className="min-w-20 flex-1 border-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
      />
    </div>
  );
}
