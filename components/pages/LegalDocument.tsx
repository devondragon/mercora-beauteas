import type { PageSection } from "@/lib/cms/page-sections";

/**
 * Dense policy text stays in one continuous card — splitting several thousand
 * words into a dozen boxes reads as frantic. Headings get hairline separators
 * and anchor ids so the contents rail still works.
 */
interface LegalDocumentProps {
  updatedLabel: string | null;
  lead: string;
  sections: PageSection[];
}

export default function LegalDocument({ updatedLabel, lead, sections }: LegalDocumentProps) {
  return (
    <article className="bg-white border border-border-default rounded-xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(122,80,66,0.05),0_8px_22px_-14px_rgba(122,80,66,0.22)]">
      {updatedLabel && (
        <p className="inline-block text-xs px-3 py-1 rounded-full bg-secondary-100 text-secondary-600 border border-secondary-400/50 mb-5">
          {updatedLabel}
        </p>
      )}

      {lead && (
        <div
          className="prose max-w-[66ch] prose-p:text-text-secondary prose-a:text-primary-700 prose-strong:text-text-primary"
          dangerouslySetInnerHTML={{ __html: lead }}
        />
      )}

      {sections.map((section, index) => (
        <div
          key={section.id}
          id={section.id}
          className={`scroll-mt-24 ${index === 0 && !lead ? "" : "mt-7 pt-4 border-t border-surface"}`}
        >
          <h2 className="font-serif text-[19px] font-semibold text-text-primary">
            {section.heading}
          </h2>
          <div
            className="prose max-w-[66ch] prose-p:text-text-secondary prose-li:text-text-secondary prose-a:text-primary-700 prose-strong:text-text-primary"
            dangerouslySetInnerHTML={{ __html: section.html }}
          />
        </div>
      ))}
    </article>
  );
}
