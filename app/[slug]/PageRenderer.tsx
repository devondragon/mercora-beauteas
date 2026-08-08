/**
 * Page Renderer — Content Management System
 *
 * Server component. Sanitizes stored page HTML, parses it into a section model,
 * resolves any referenced products, and dispatches to the template body chosen
 * by the page's `template` column. Admin-authored CSS/JS is delegated to a
 * small client child so this component can stay on the server.
 */
import { PageSelect } from "@/lib/db/schema/pages";
import { sanitizePageHtmlServer } from "@/lib/utils/sanitize-html-server";
import { parsePageHtml } from "@/lib/cms/page-sections";
import { resolveTemplate, shouldShowRail } from "@/lib/cms/page-template";
import { resolveSectionBlends, type BlendCardData } from "@/lib/cms/page-products";
import PageHero from "@/components/pages/PageHero";
import PageRail from "@/components/pages/PageRail";
import PageCta from "@/components/pages/PageCta";
import SectionCard from "@/components/pages/SectionCard";
import FaqAccordion from "@/components/pages/FaqAccordion";
import ContactGrid from "@/components/pages/ContactGrid";
import LegalDocument from "@/components/pages/LegalDocument";
import StoryBody from "@/components/pages/StoryBody";
import CustomPageAssets from "@/components/pages/CustomPageAssets";

interface PageRendererProps {
  page: PageSelect;
  /**
   * Kill switch (BMC-163): admin-authored `custom_js` is executed via
   * `new Function(...)()` only when this is explicitly `true`. Defaults to
   * `false` (secure by default) so a missing/omitted flag never runs the code.
   */
  customJsEnabled?: boolean;
}

export default async function PageRenderer({ page, customJsEnabled = false }: PageRendererProps) {
  const template = resolveTemplate(page.template);
  const sanitized = sanitizePageHtmlServer(page.content);

  // A stored excerpt is the authored lede; otherwise promote the page's own
  // first paragraph rather than inventing copy.
  // Conventions and the "Last Updated" pill are only lifted for the templates
  // that render them; extracting for a template that does not would delete the
  // markup from the page with nothing putting it back.
  const parsed = parsePageHtml(sanitized, {
    promoteLede: !page.excerpt,
    extractConventions: template.kind === "guide",
    liftUpdatedLabel: template.kind === "legal",
  });
  const lede = page.excerpt || parsed.lede;

  // Annotated: a bare `new Map()` infers Map<any, any>, which would widen the
  // union and silently disable the BlendCardData prop check on SectionCard.
  const blends: Map<string, BlendCardData> =
    template.kind === "guide" ? await resolveSectionBlends(parsed.sections) : new Map();
  const withRail = shouldShowRail(template, parsed.sections.length);

  const body = (() => {
    switch (template.kind) {
      case "guide":
        return (
          <div>
            {parsed.lead && (
              <div
                className="prose max-w-[66ch] mb-5 prose-p:text-text-secondary prose-a:text-primary-700"
                dangerouslySetInnerHTML={{ __html: parsed.lead }}
              />
            )}
            {parsed.sections.map((section) => (
              <SectionCard key={section.id} section={section} blend={blends.get(section.id)} />
            ))}
          </div>
        );
      case "faq":
        return <FaqAccordion sections={parsed.sections} lead={parsed.lead} />;
      case "contact":
        return <ContactGrid sections={parsed.sections} lead={parsed.lead} />;
      case "legal":
        return (
          <LegalDocument
            updatedLabel={parsed.updatedLabel}
            lead={parsed.lead}
            sections={parsed.sections}
          />
        );
      case "story":
      case "closing":
        return <StoryBody lead={parsed.lead} sections={parsed.sections} />;
    }
  })();

  return (
    <>
      <CustomPageAssets
        pageId={page.id}
        customCss={page.custom_css}
        customJs={page.custom_js}
        customJsEnabled={customJsEnabled}
      />

      <PageHero eyebrow={template.eyebrow} title={page.title} lede={lede} />

      <div
        className={`max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 ${
          withRail ? "lg:grid lg:grid-cols-[170px_1fr] lg:gap-10" : ""
        }`}
      >
        {withRail && <PageRail sections={parsed.sections} />}
        <div className="min-w-0">{body}</div>
      </div>

      {template.cta && <PageCta config={template.cta} />}
    </>
  );
}
