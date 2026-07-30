import { Mail, Clock, Package, HelpCircle, Heart } from "lucide-react";
import type { PageSection } from "@/lib/cms/page-sections";

/**
 * Short pages with several small sections become an info grid rather than a
 * stack of near-empty cards. The final card spans both columns when the count
 * is odd, so the grid never ends ragged.
 */
interface ContactGridProps {
  sections: PageSection[];
  lead: string;
}

/** Keyword → icon, with a neutral default. Ordered most-specific first. */
const ICONS: { match: RegExp; Icon: typeof Mail }[] = [
  { match: /email|write|message/i, Icon: Mail },
  // Order/shipping is checked before hours: "support" is the broader word, so
  // an admin heading like "Order Support" would otherwise get Clock, not Package.
  // Existing headings are unaffected — "Customer Support Hours" still lands on
  // Clock, "Order and Shipping Questions" on Package.
  { match: /order|shipping|delivery|return/i, Icon: Package },
  { match: /hour|time|support/i, Icon: Clock },
  { match: /question|faq|help/i, Icon: HelpCircle },
];

function iconFor(heading: string) {
  return ICONS.find((entry) => entry.match.test(heading))?.Icon ?? Heart;
}

export default function ContactGrid({ sections, lead }: ContactGridProps) {
  return (
    <div>
      {lead && (
        <div
          className="prose max-w-[66ch] mb-6 prose-p:text-text-secondary prose-a:text-primary-700"
          dangerouslySetInnerHTML={{ __html: lead }}
        />
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {sections.map((section, index) => {
          const Icon = iconFor(section.heading);
          const isLastOdd = index === sections.length - 1 && sections.length % 2 === 1;
          return (
            <section
              key={section.id}
              id={section.id}
              className={`scroll-mt-24 bg-white border border-border-default rounded-xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(122,80,66,0.05),0_8px_22px_-14px_rgba(122,80,66,0.22)] ${isLastOdd ? "sm:col-span-2" : ""}`}
            >
              <span className="w-9 h-9 rounded-lg bg-secondary-100 border border-secondary-400/50 flex items-center justify-center mb-3">
                <Icon aria-hidden className="w-4 h-4 text-secondary-600" />
              </span>
              <h2 className="font-serif text-[17px] font-semibold text-text-primary mb-1">
                {section.heading}
              </h2>
              <div
                className="prose prose-sm max-w-none prose-p:text-text-secondary prose-p:my-0 prose-a:text-primary-700"
                dangerouslySetInnerHTML={{ __html: section.html }}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
