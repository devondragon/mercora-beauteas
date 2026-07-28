/**
 * Template configuration for CMS pages.
 *
 * The `pages.template` column selects a layout; this module turns that value
 * into everything the renderer needs — hero eyebrow, whether to show the
 * contents rail, and the closing CTA. All user-facing strings here are approved
 * brand microcopy; change them deliberately, not incidentally.
 */

export type PageTemplateKind = "guide" | "faq" | "contact" | "legal" | "story";

export interface PageCtaAction {
  label: string;
  href: string;
  variant: "primary" | "secondary";
}

export interface PageCtaConfig {
  heading: string;
  body: string;
  actions: PageCtaAction[];
  /** Legal pages also surface links to their sibling policies. */
  showPolicyLinks: boolean;
}

export interface PageTemplateConfig {
  kind: PageTemplateKind;
  eyebrow: string;
  showRail: boolean;
  cta: PageCtaConfig | null;
}

/** Below this, a contents rail is noise rather than navigation. */
export const MIN_SECTIONS_FOR_RAIL = 3;

export const POLICY_LINKS = Object.freeze([
  Object.freeze({ label: "Shipping Policy", href: "/shipping-policy" }),
  Object.freeze({ label: "Refund & Returns", href: "/refund-policy" }),
  Object.freeze({ label: "Privacy Policy", href: "/privacy-policy" }),
  Object.freeze({ label: "Terms of Service", href: "/terms-of-service" }),
]);

const SHOP: PageCtaAction = Object.freeze({
  label: "Shop the teas",
  href: "/category/clearly-calendula",
  variant: "primary",
});

const TEMPLATES: Record<PageTemplateKind, PageTemplateConfig> = Object.freeze({
  guide: Object.freeze({
    kind: "guide",
    eyebrow: "CARE GUIDE",
    showRail: true,
    cta: Object.freeze({
      heading: "Ready to brew?",
      body: "Explore the Clearly Calendula collection.",
      actions: Object.freeze([SHOP, Object.freeze({ label: "Ask Chai", href: "/agent", variant: "secondary" })]),
      showPolicyLinks: false,
    }),
  }),
  faq: Object.freeze({
    kind: "faq",
    eyebrow: "GOOD QUESTIONS",
    showRail: true,
    cta: Object.freeze({
      heading: "Still have a question?",
      body: "We answer every email within 1–2 business days.",
      actions: Object.freeze([
        Object.freeze({ label: "Contact us", href: "/contact", variant: "primary" }),
        Object.freeze({ label: "Ask Chai", href: "/agent", variant: "secondary" }),
      ]),
      showPolicyLinks: false,
    }),
  }),
  legal: Object.freeze({
    kind: "legal",
    eyebrow: "THE FINE PRINT",
    showRail: true,
    cta: Object.freeze({
      heading: "Need a hand?",
      body: "If anything here is unclear, we're happy to explain.",
      actions: Object.freeze([Object.freeze({ label: "Contact us", href: "/contact", variant: "primary" })]),
      showPolicyLinks: true,
    }),
  }),
  contact: Object.freeze({
    kind: "contact",
    eyebrow: "SAY HELLO",
    showRail: false,
    // The contact page is itself the call to action.
    cta: null,
  }),
  story: Object.freeze({
    kind: "story",
    eyebrow: "OUR STORY",
    showRail: false,
    cta: Object.freeze({
      heading: "Build your beauty from within.",
      body: "",
      actions: Object.freeze([SHOP, Object.freeze({ label: "See subscriptions", href: "/subscriptions", variant: "secondary" })]),
      showPolicyLinks: false,
    }),
  }),
});

export function resolveTemplate(template: string | null | undefined): PageTemplateConfig {
  if (template && Object.prototype.hasOwnProperty.call(TEMPLATES, template)) {
    return TEMPLATES[template as PageTemplateKind];
  }
  // `default` and the legacy `about` template both land here.
  return TEMPLATES.story;
}

export function shouldShowRail(config: PageTemplateConfig, sectionCount: number): boolean {
  return config.showRail && sectionCount >= MIN_SECTIONS_FOR_RAIL;
}
