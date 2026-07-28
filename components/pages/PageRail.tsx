import type { PageSection } from "@/lib/cms/page-sections";

/**
 * Sticky "on this page" contents rail. Anchors are injected ids from the
 * section parser, so they always match the rendered headings.
 */
interface PageRailProps {
  sections: PageSection[];
  label?: string;
}

export default function PageRail({ sections, label = "On this page" }: PageRailProps) {
  return (
    <nav aria-label={label} className="hidden lg:block self-start sticky top-6">
      <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted mb-3">{label}</p>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          className="block text-[15px] leading-snug text-text-secondary hover:text-primary-700 border-l-2 border-border-default hover:border-primary-500 pl-3 py-[7px] transition-colors"
        >
          {section.heading}
        </a>
      ))}
    </nav>
  );
}
