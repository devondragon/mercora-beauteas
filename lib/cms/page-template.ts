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

/**
 * Deep-freezes an object or array and all nested objects/arrays recursively.
 * Returns the same value at the type level (preserving mutability in TypeScript),
 * but the runtime value is frozen to prevent accidental mutations.
 */
function deepFreeze<T>(value: T): T {
  Object.freeze(value);
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach((item) => {
      if (typeof item === "object" && item !== null) {
        deepFreeze(item);
      }
    });
  }
  return value;
}

export const POLICY_LINKS = deepFreeze([
  { label: "Shipping Policy", href: "/shipping-policy" },
  { label: "Refund & Returns", href: "/refund-policy" },
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Service", href: "/terms-of-service" },
]);

const SHOP: PageCtaAction = {
  label: "Shop the teas",
  href: "/category/clearly-calendula",
  variant: "primary",
};

const TEMPLATES: Record<PageTemplateKind, PageTemplateConfig> = deepFreeze({
  guide: {
    kind: "guide",
    eyebrow: "CARE GUIDE",
    showRail: true,
    cta: {
      heading: "Ready to brew?",
      body: "Explore the Clearly Calendula collection.",
      actions: [SHOP, { label: "Ask Chai", href: "/agent", variant: "secondary" }],
      showPolicyLinks: false,
    },
  },
  faq: {
    kind: "faq",
    eyebrow: "GOOD QUESTIONS",
    showRail: true,
    cta: {
      heading: "Still have a question?",
      body: "We answer every email within 1–2 business days.",
      actions: [
        { label: "Contact us", href: "/contact", variant: "primary" },
        { label: "Ask Chai", href: "/agent", variant: "secondary" },
      ],
      showPolicyLinks: false,
    },
  },
  legal: {
    kind: "legal",
    eyebrow: "THE FINE PRINT",
    showRail: true,
    cta: {
      heading: "Need a hand?",
      body: "If anything here is unclear, we're happy to explain.",
      actions: [{ label: "Contact us", href: "/contact", variant: "primary" }],
      showPolicyLinks: true,
    },
  },
  contact: {
    kind: "contact",
    eyebrow: "SAY HELLO",
    showRail: false,
    // The contact page is itself the call to action.
    cta: null,
  },
  story: {
    kind: "story",
    eyebrow: "OUR STORY",
    showRail: false,
    cta: {
      heading: "Build your beauty from within.",
      body: "",
      actions: [SHOP, { label: "See subscriptions", href: "/subscriptions", variant: "secondary" }],
      showPolicyLinks: false,
    },
  },
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
