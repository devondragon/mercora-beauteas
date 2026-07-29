"use client";

import { useEffect, useRef, useState } from "react";
import type { PageSection } from "@/lib/cms/page-sections";

/**
 * Sticky "on this page" contents rail. Anchors are injected ids from the
 * section parser, so they always match the rendered headings.
 *
 * Highlights whichever section is currently in the reader's view
 * (scroll-spy) via IntersectionObserver. Renders with no active item on the
 * server / before hydration, then picks one up once the observer attaches.
 */
interface PageRailProps {
  sections: PageSection[];
  label?: string;
}

export default function PageRail({ sections, label = "On this page" }: PageRailProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Persists intersection state across callbacks — each IntersectionObserver
  // callback only reports entries whose visibility just changed, not the
  // full current set, so we need to remember the rest ourselves.
  const visibleRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    visibleRef.current = new Map();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibleRef.current.set(entry.target.id, entry.isIntersecting);
        }
        // `sections` is in document order, so the first section that is
        // currently visible is the topmost one in the reader's viewport —
        // not whichever entry happened to fire last in this batch.
        const current = sections.find((section) => visibleRef.current.get(section.id));
        setActiveId(current?.id ?? null);
      },
      // Only count a section as "in view" while it overlaps a narrow band
      // near the top of the viewport. This anchors "in view" to the
      // reader's position (rather than "anything on screen"), so several
      // sections can be visible at once without ambiguity, and rapid
      // scrolling settles on one section instead of flickering between
      // neighbours.
      { rootMargin: "-96px 0px -65% 0px", threshold: 0 },
    );

    for (const el of elements) observer.observe(el);

    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav aria-label={label} className="hidden lg:block self-start sticky top-6">
      <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-3">{label}</p>
      {sections.map((section) => {
        const isActive = section.id === activeId;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            className={`block text-[15px] leading-snug border-l-2 pl-3 py-[7px] transition-colors ${
              isActive
                ? "border-primary-500 text-primary-700 font-semibold"
                : "text-text-secondary hover:text-primary-700 border-border-default hover:border-primary-500"
            }`}
          >
            {section.heading}
          </a>
        );
      })}
    </nav>
  );
}
