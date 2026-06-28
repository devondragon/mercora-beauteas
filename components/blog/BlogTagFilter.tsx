"use client";
import { useState } from "react";

interface BlogTagFilterProps {
  tags: string[];
}

export function BlogTagFilter({ tags }: BlogTagFilterProps) {
  const [active, setActive] = useState("all");

  function filter(tag: string) {
    setActive(tag);
    const posts = document.querySelectorAll<HTMLElement>("[data-post-tags]");
    posts.forEach((el) => {
      if (tag === "all") { el.classList.remove("hidden"); return; }
      const postTags = (el.dataset.postTags ?? "").split(",");
      el.classList.toggle("hidden", !postTags.includes(tag));
    });
  }

  if (tags.length === 0) return null;

  return (
    <div className="mb-10 flex flex-wrap justify-center gap-2">
      {["all", ...tags].map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => filter(tag)}
          className={`rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors ${
            active === tag
              ? "bg-amber-600 text-white"
              : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
          }`}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
