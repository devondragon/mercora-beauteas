"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PageSection } from "@/lib/cms/page-sections";

/**
 * FAQ questions as an accordion. The first answer is open so the page never
 * reads as an empty list of headings. Rows keep their anchor ids so the
 * contents rail can link straight to a question.
 */
interface FaqAccordionProps {
  sections: PageSection[];
}

export default function FaqAccordion({ sections }: FaqAccordionProps) {
  const [openId, setOpenId] = useState<string | null>(sections[0]?.id ?? null);

  return (
    <div className="bg-white border border-border-default rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(122,80,66,0.05),0_8px_22px_-14px_rgba(122,80,66,0.22)]">
      {sections.map((section) => {
        const isOpen = openId === section.id;
        return (
          <div key={section.id} id={section.id} className="scroll-mt-24 border-b border-border-default last:border-b-0">
            <h2>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : section.id)}
                aria-expanded={isOpen}
                aria-controls={`${section.id}-answer`}
                className="w-full flex items-center gap-3 text-left px-5 sm:px-6 py-4 font-serif text-[17.5px] text-text-primary hover:bg-surface-dark transition-colors"
              >
                <span className="flex-1">{section.heading}</span>
                <ChevronDown
                  aria-hidden
                  className={`w-5 h-5 flex-none text-primary-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
            </h2>
            {isOpen && (
              <div
                id={`${section.id}-answer`}
                className="px-5 sm:px-6 pb-5 prose max-w-[64ch] prose-p:text-text-secondary prose-li:text-text-secondary prose-a:text-primary-700 prose-strong:text-text-primary"
                dangerouslySetInnerHTML={{ __html: section.html }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
