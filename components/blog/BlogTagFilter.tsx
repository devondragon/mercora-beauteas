"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";

interface BlogTagFilterProps {
  tags: string[];
}

export function BlogTagFilter({ tags }: BlogTagFilterProps) {
  const searchParams = useSearchParams();
  const initialTag = searchParams.get("tag") ?? "all";
  const [active, setActive] = useState(initialTag);

  function filter(tag: string) {
    setActive(tag);
    const posts = document.querySelectorAll<HTMLElement>("[data-post-tags]");
    posts.forEach((el) => {
      if (tag === "all") { el.classList.remove("hidden"); return; }
      let postTags: string[] = [];
      try { postTags = JSON.parse(el.dataset.postTags ?? "[]"); } catch { postTags = []; }
      el.classList.toggle("hidden", !postTags.includes(tag));
    });
  }

  useEffect(() => {
    if (initialTag !== "all") filter(initialTag);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (tags.length === 0) return null;

  return (
    <div role="group" aria-label="Filter posts by tag" className="mb-10 flex flex-wrap justify-center gap-2">
      {["all", ...tags].map((tag) => (
        <button
          key={tag}
          type="button"
          aria-pressed={active === tag}
          onClick={() => filter(tag)}
          className={`rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
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
