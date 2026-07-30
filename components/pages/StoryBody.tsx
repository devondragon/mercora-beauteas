import type { PageSection } from "@/lib/cms/page-sections";

/**
 * Narrative pages (About, Subscriptions) — one wide card, generous measure,
 * inline photography rendered large and rounded. These pages often have no
 * headings at all, in which case only the lead renders.
 */
interface StoryBodyProps {
  lead: string;
  sections: PageSection[];
}

const PROSE =
  "prose max-w-[66ch] mx-auto prose-headings:font-serif prose-headings:text-text-primary prose-p:text-text-secondary prose-li:text-text-secondary prose-a:text-primary-700 prose-strong:text-text-primary prose-img:rounded-xl prose-img:w-full prose-img:my-8";

export default function StoryBody({ lead, sections }: StoryBodyProps) {
  return (
    <article className="bg-white border border-border-default rounded-xl p-6 sm:p-10 shadow-[0_1px_2px_rgba(122,80,66,0.05),0_8px_22px_-14px_rgba(122,80,66,0.22)]">
      {lead && <div className={PROSE} dangerouslySetInnerHTML={{ __html: lead }} />}
      {sections.map((section) => (
        <div key={section.id} id={section.id} className="scroll-mt-24 mt-8">
          <div className="max-w-[66ch] mx-auto">
            <h2 className="font-serif text-2xl font-semibold text-text-primary mb-2">
              {section.heading}
            </h2>
          </div>
          <div className={PROSE} dangerouslySetInnerHTML={{ __html: section.html }} />
        </div>
      ))}
    </article>
  );
}
