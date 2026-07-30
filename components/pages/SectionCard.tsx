import Link from "next/link";
import Image from "next/image";
import type { PageSection } from "@/lib/cms/page-sections";
import type { BlendCardData } from "@/lib/cms/page-products";

/**
 * One `<h2>` section of a guide page, rendered as a white card on cream.
 * Chips carry the at-a-glance specs, blockquotes become blush callouts, and a
 * referenced blend gets a shoppable column so the guide is a path to purchase
 * rather than a dead end.
 */
interface SectionCardProps {
  section: PageSection;
  blend?: BlendCardData;
}

export default function SectionCard({ section, blend }: SectionCardProps) {
  return (
    <section
      id={section.id}
      className="scroll-mt-24 bg-white border border-border-default rounded-xl p-6 sm:p-7 mb-4 shadow-[0_1px_2px_rgba(122,80,66,0.05),0_8px_22px_-14px_rgba(122,80,66,0.22)]"
    >
      <div className={blend ? "grid sm:grid-cols-[1fr_168px] gap-7" : ""}>
        <div>
          <h2 className="font-serif text-xl sm:text-[23px] font-semibold text-text-primary">
            {section.heading}
          </h2>

          {section.specs.length > 0 && (
            <ul className="flex flex-wrap gap-2 mt-3 mb-3 list-none p-0">
              {/* Keyed by index too: two identical chips are legitimate content, and
                  keying on the text alone collides. */}
              {section.specs.map((spec, index) => (
                <li
                  key={`${index}-${spec}`}
                  className="text-[12.5px] px-3 py-1 rounded-full bg-secondary-100 text-secondary-600 border border-secondary-400/50"
                >
                  {spec}
                </li>
              ))}
            </ul>
          )}

          <div
            className="prose max-w-[66ch] prose-headings:font-serif prose-headings:text-text-primary prose-p:text-text-secondary prose-li:text-text-secondary prose-a:text-primary-700 prose-strong:text-text-primary prose-img:rounded-xl"
            dangerouslySetInnerHTML={{ __html: section.html }}
          />

          {section.callouts.map((callout, index) => (
            <p
              key={`${index}-${callout}`}
              className="mt-4 py-3 px-4 bg-surface-dark border-l-[3px] border-primary-400 rounded-r-lg text-[15px] leading-relaxed text-text-secondary"
            >
              {callout}
            </p>
          ))}
        </div>

        {blend && (
          <div className="text-center">
            <Link href={`/product/${blend.slug}`} className="block">
              <Image
                src={blend.imageKey}
                alt={blend.name}
                width={168}
                height={224}
                className="w-full rounded-lg border border-border-default bg-surface-dark"
              />
            </Link>
            <p className="font-serif text-sm text-text-primary mt-3 mb-0.5 leading-tight">
              {blend.name}
            </p>
            {blend.price && <p className="text-[13.5px] text-text-muted mb-2">{blend.price}</p>}
            <Link
              href={`/product/${blend.slug}`}
              className="block text-[13.5px] py-1.5 px-3 border border-primary-400 text-primary-700 rounded-md hover:bg-primary-400 hover:text-text-inverse transition-colors"
            >
              Shop this blend
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
