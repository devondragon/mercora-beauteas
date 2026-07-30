/**
 * Template configuration for CMS pages.
 *
 * The `pages.template` column selects a layout; this module turns that value
 * into everything the renderer needs — hero eyebrow, whether to show the
 * contents rail, and the closing CTA. All user-facing strings here are approved
 * brand microcopy; change them deliberately, not incidentally.
 */

/**
 * The render kinds, single-sourced so the runtime list and the type cannot drift.
 *
 * NOTE: this is the render-time registry, and it is NOT the `page_templates`
 * TABLE, which drives the admin editor's Template dropdown. Migration 0003
 * seeded that table with `default`/`legal`/`about`; migration 0020 adds the
 * remaining kinds so every value here is selectable. Adding a kind here must be
 * paired with a `page_templates` INSERT, or admins cannot choose it and re-saving
 * such a page through the editor resets it to the story fallback.
 */
export const TEMPLATE_KINDS = ["guide", "faq", "contact", "legal", "story"] as const;

export type PageTemplateKind = (typeof TEMPLATE_KINDS)[number];

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

/**
 * Values of `pages.template` that predate this template system. They are
 * deliberate aliases rather than fallbacks: `default` is the column default (so
 * every page created outside the admin arrives with it) and `about` was seeded
 * by migration 0003. Mapping them explicitly keeps a genuine typo distinguishable
 * from a legacy value.
 *
 * A Map, not an object literal: `pages.template` is arbitrary stored text, and
 * indexing an object with it would resolve inherited keys like "constructor".
 */
const LEGACY_ALIASES = new Map<string, PageTemplateKind>([
  ["default", "story"],
  ["about", "story"],
]);

/** Narrow an arbitrary stored string to a render kind, or null if it is neither. */
export function parseTemplateKind(template: string | null | undefined): PageTemplateKind | null {
  if (!template) return null;
  if (TEMPLATE_KINDS.includes(template as PageTemplateKind)) return template as PageTemplateKind;
  return LEGACY_ALIASES.get(template) ?? null;
}

export function resolveTemplate(template: string | null | undefined): PageTemplateConfig {
  const kind = parseTemplateKind(template);
  if (kind) return TEMPLATES[kind];
  if (template) {
    // An unrecognized template silently renders as a story page — complete with a
    // shop CTA — which is the wrong design for, say, a policy page. Surface it.
    console.warn(`[page-template] unknown template "${template}"; falling back to story`);
  }
  return TEMPLATES.story;
}

export function shouldShowRail(config: PageTemplateConfig, sectionCount: number): boolean {
  return config.showRail && sectionCount >= MIN_SECTIONS_FOR_RAIL;
}
