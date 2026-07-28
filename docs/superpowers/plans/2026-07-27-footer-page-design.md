# Footer Nav Page Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic CMS page renderer with a template system ("Structured Guide") so every footer-linked page — and every future CMS page — gets a designed hero, contents rail, section cards, shoppable product columns, and a closing CTA.

**Architecture:** `app/[slug]/PageRenderer.tsx` becomes a **server component**. It sanitizes page HTML server-side, parses it into a typed section model via pure functions in `lib/cms/`, resolves any referenced products from D1, and renders presentational components. Most Shopify cruft removal happens at **render time** in the parser (not in a migration), so it also fixes any future imported content. The data migration is limited to what cannot be derived: `template`, `excerpt`, the additive `ul.specs`/`figure.blend`/`blockquote` conventions on Brewing Directions, image URL rewrites, and archiving the duplicate About page.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript strict, Tailwind (brand tokens from `lib/brand.config.ts`), Vitest (`tests/unit/**/*.test.ts`, jsdom, `@` alias → repo root), Wrangler D1 raw-SQL migrations, R2 via the existing `/media/[...key]` proxy route.

## Global Constraints

- **Run `npm run lint` before considering any task done.** There is no Prettier.
- **Vitest unit config only picks up `tests/unit/**/*.test.ts`** — `.tsx` is NOT included, so all new tests must target pure `.ts` modules. Do not write component tests here.
- **Unit-test modules must be pure** — no `getCloudflareContext()`, no `lib/db`, no `lib/models` imports in anything under test.
- **Never modify the sanitizer allowlist.** `lib/utils/sanitize-html-core.ts` permits `class` on `*` and allows `figure`; `id` and `data-*` are NOT allowed. Heading anchors are injected by the renderer after sanitization.
- **Money:** all monetary values flow through `lib/money` (`Money`). Display via `.format()`. Never write raw `*100` / `/100`.
- **Next migration number is `0019`.** `0011`–`0018` are taken and the two `0010` files stay as they are — do not renumber anything.
- **D1 caps LIKE patterns at 50 characters.** Any `LIKE '%…%'` idempotency guard must use a short substring or the whole migration silently rolls back.
- **The dev and prod `pages` tables diverge** — prod has an `about` row, dev does not. Every statement must tolerate a missing row (`UPDATE` matching zero rows is fine; never assume a row exists).
- **Approved microcopy — use these exact strings.** These are the only new words in the project.

  | Template | Eyebrow |
  |---|---|
  | `guide` | `CARE GUIDE` |
  | `faq` | `GOOD QUESTIONS` |
  | `legal` | `THE FINE PRINT` |
  | `contact` | `SAY HELLO` |
  | `story` | `OUR STORY` |

  Ledes (only for pages with no intro paragraph of their own):
  - FAQ — `Ingredients, caffeine, brewing and subscriptions — the things people ask us most.`
  - Shipping Policy — `How and when your order gets to you.`
  - Refund & Return Policy — `What to do if something isn't right.`

  CTAs:
  - `guide` — **Ready to brew?** / `Explore the Clearly Calendula collection.` / [Shop the teas → `/category/clearly-calendula`] [Ask Chai → `/agent`]
  - `faq` — **Still have a question?** / `We answer every email within 1–2 business days.` / [Contact us → `/contact`] [Ask Chai → `/agent`]
  - `legal` — **Need a hand?** / `If anything here is unclear, we're happy to explain.` / [Contact us → `/contact`] + sibling policy pills
  - `contact` — no CTA (the whole page is one)
  - `story` — **Build your beauty from within.** / `` / [Shop the teas → `/category/clearly-calendula`] [See subscriptions → `/subscriptions`]

### Deviations from the spec (deliberate, approved rationale)

1. **Cruft removal and FAQ heading promotion move from the migration to render-time parsing** (Task 1). Smaller and safer migration, no destructive rewrite of stored content, and future Shopify-imported pages are fixed automatically.
2. **No `p.updated` convention.** All four legal pages already begin with `<p><strong>Last Updated:</strong> DATE</p>`. The parser detects that existing pattern and lifts it into the pill — zero content change needed.
3. **Only three pages need a written lede, not five.** Privacy Policy and Terms of Service each already open with a real intro paragraph, which the parser promotes automatically. Their own words are used instead of new ones.

---

### Task 1: HTML normalization

Strips migrated-Shopify cruft and promotes bold-paragraph questions to real headings, so downstream parsing sees clean semantic markup.

**Files:**
- Create: `lib/cms/page-html.ts`
- Test: `tests/unit/lib/cms/page-html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normalizePageHtml(html: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/cms/page-html.test.ts
import { describe, it, expect } from "vitest";
import { normalizePageHtml } from "@/lib/cms/page-html";

describe("normalizePageHtml", () => {
  it("drops paragraphs that hold only whitespace or &nbsp;", () => {
    const html = "<p>Real copy.</p><p> </p><p>&nbsp;</p><p>\n  </p><p>More.</p>";
    expect(normalizePageHtml(html)).toBe("<p>Real copy.</p><p>More.</p>");
  });

  it("drops hidden divs and stray meta tags left by the Shopify export", () => {
    const html = '<div style="display: none;"></div><meta charset="UTF-8"><p>Copy.</p>';
    expect(normalizePageHtml(html)).toBe("<p>Copy.</p>");
  });

  it("strips inline style attributes but keeps the element", () => {
    const html = '<div style="text-align: center;"><p>Centered.</p></div>';
    expect(normalizePageHtml(html)).toBe("<div><p>Centered.</p></div>");
  });

  it("promotes a paragraph that is entirely a bold question to an h2", () => {
    const html = "<p><strong>Are Your Teas Organic?</strong></p><p>Yes.</p>";
    expect(normalizePageHtml(html)).toBe("<h2>Are Your Teas Organic?</h2><p>Yes.</p>");
  });

  it("promotes bold questions that mix <strong> and <b>", () => {
    const html = "<p><strong>Do Your Teas Have </strong><b>Caffeine?</b></p>";
    expect(normalizePageHtml(html)).toBe("<h2>Do Your Teas Have Caffeine?</h2>");
  });

  it("leaves a bold run alone when it is not a question", () => {
    const html = "<p><strong>Last Updated:</strong> 2026-07-14</p>";
    expect(normalizePageHtml(html)).toBe("<p><strong>Last Updated:</strong> 2026-07-14</p>");
  });

  it("leaves a paragraph alone when the bold text is only part of it", () => {
    const html = "<p><strong>Standard</strong> — 5 to 7 business days?</p>";
    expect(normalizePageHtml(html)).toBe("<p><strong>Standard</strong> — 5 to 7 business days?</p>");
  });

  it("is idempotent", () => {
    const html = "<p><strong>Are Your Teas Organic?</strong></p><p>&nbsp;</p>";
    const once = normalizePageHtml(html);
    expect(normalizePageHtml(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/cms/page-html.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cms/page-html"`

- [ ] **Step 3: Write the implementation**

```ts
// lib/cms/page-html.ts
/**
 * Normalization pass over CMS page HTML, applied at render time.
 *
 * The Shopify→Mercora ETL left artifacts in migrated page bodies: empty
 * paragraphs used as spacers, hidden divs, stray <meta charset> tags, and
 * questions marked up as bold paragraphs rather than headings. Cleaning these
 * at render time (rather than rewriting stored content) keeps the CMS source
 * editable and fixes any future imported page for free.
 *
 * Runs AFTER sanitization, so the markup is already well-formed and the
 * allowlist has been applied.
 */

/** Paragraphs holding nothing but whitespace/&nbsp; were used as Shopify spacers. */
const EMPTY_PARAGRAPH = /<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi;

/** Hidden divs and stray <meta> tags the export scattered through the body. */
const HIDDEN_DIV = /<div[^>]*style=["'][^"']*display:\s*none[^"']*["'][^>]*>\s*<\/div>/gi;
const STRAY_META = /<meta[^>]*>/gi;

/** `style` is not on the sanitizer allowlist, but legacy stored HTML still has it. */
const STYLE_ATTR = /\s+style=["'][^"']*["']/gi;

/**
 * A paragraph whose entire content is one or more bold runs — the shape the
 * Shopify FAQ export used for questions.
 */
const BOLD_ONLY_PARAGRAPH = /<p>((?:\s*<(?:strong|b)>[\s\S]*?<\/(?:strong|b)>\s*)+)<\/p>/gi;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

export function normalizePageHtml(html: string): string {
  return html
    .replace(HIDDEN_DIV, "")
    .replace(STRAY_META, "")
    .replace(STYLE_ATTR, "")
    .replace(BOLD_ONLY_PARAGRAPH, (match, inner: string) => {
      const text = stripTags(inner).replace(/\s+/g, " ").trim();
      // Only promote actual questions. "Last Updated:" and similar bold labels
      // must stay paragraphs, or legal pages sprout spurious sections.
      return text.endsWith("?") ? `<h2>${text}</h2>` : match;
    })
    .replace(EMPTY_PARAGRAPH, "")
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/cms/page-html.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add lib/cms/page-html.ts tests/unit/lib/cms/page-html.test.ts
git commit -m "feat(cms): normalize migrated Shopify page HTML at render time"
```

---

### Task 2: Page section parser

Turns normalized HTML into the typed model every template renders from.

**Files:**
- Create: `lib/cms/page-sections.ts`
- Test: `tests/unit/lib/cms/page-sections.test.ts`

**Interfaces:**
- Consumes: `normalizePageHtml` from Task 1.
- Produces:
  ```ts
  interface PageSection { id: string; heading: string; html: string; specs: string[]; productSlug: string | null; callouts: string[] }
  interface ParsedPage { updatedLabel: string | null; lede: string | null; lead: string; sections: PageSection[] }
  parsePageHtml(html: string, options?: { promoteLede?: boolean }): ParsedPage
  slugifyHeading(text: string): string
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/cms/page-sections.test.ts
import { describe, it, expect } from "vitest";
import { parsePageHtml, slugifyHeading } from "@/lib/cms/page-sections";

describe("slugifyHeading", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyHeading("Black Teas")).toBe("black-teas");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugifyHeading("Are Your Teas  Organic?")).toBe("are-your-teas-organic");
  });

  it("falls back to 'section' for headings with no usable characters", () => {
    expect(slugifyHeading("!!!")).toBe("section");
  });
});

describe("parsePageHtml", () => {
  it("splits on h2 boundaries and keeps the body with its heading", () => {
    const { sections } = parsePageHtml("<h2>Black Teas</h2><p>Hot.</p><h2>Iced Teas</h2><p>Cold.</p>");
    expect(sections.map((s) => s.heading)).toEqual(["Black Teas", "Iced Teas"]);
    expect(sections[0].html).toBe("<p>Hot.</p>");
    expect(sections[1].html).toBe("<p>Cold.</p>");
  });

  it("assigns slugified ids and de-duplicates collisions", () => {
    const { sections } = parsePageHtml("<h2>Returns</h2><p>a</p><h2>Returns</h2><p>b</p>");
    expect(sections.map((s) => s.id)).toEqual(["returns", "returns-2"]);
  });

  it("keeps content before the first h2 as the lead", () => {
    const { lead, sections } = parsePageHtml("<p>Intro.</p><h2>One</h2><p>Body.</p>", { promoteLede: false });
    expect(lead).toBe("<p>Intro.</p>");
    expect(sections).toHaveLength(1);
  });

  it("returns no sections when the content has no h2", () => {
    const { lead, sections } = parsePageHtml("<p>Just prose.</p>", { promoteLede: false });
    expect(sections).toEqual([]);
    expect(lead).toBe("<p>Just prose.</p>");
  });

  it("promotes the first lead paragraph to the lede and removes it from the lead", () => {
    const { lede, lead } = parsePageHtml("<p>Intro sentence.</p><p>Second.</p>", { promoteLede: true });
    expect(lede).toBe("Intro sentence.");
    expect(lead).toBe("<p>Second.</p>");
  });

  it("does not promote a lede when promoteLede is false", () => {
    const { lede, lead } = parsePageHtml("<p>Intro.</p>", { promoteLede: false });
    expect(lede).toBeNull();
    expect(lead).toBe("<p>Intro.</p>");
  });

  it("lifts a leading 'Last Updated' paragraph into updatedLabel", () => {
    const { updatedLabel, lead } = parsePageHtml(
      "<p><strong>Last Updated:</strong> 2026-07-14</p><p>Policy intro.</p>",
      { promoteLede: true },
    );
    expect(updatedLabel).toBe("Last Updated: 2026-07-14");
    expect(lead).toBe("");
  });

  it("promotes the lede from the paragraph after a Last Updated line", () => {
    const { lede } = parsePageHtml(
      "<p><strong>Last Updated:</strong> 2026-07-14</p><p>Policy intro.</p>",
      { promoteLede: true },
    );
    expect(lede).toBe("Policy intro.");
  });

  it("extracts ul.specs into chip labels and removes it from the section html", () => {
    const { sections } = parsePageHtml(
      '<h2>Black Teas</h2><ul class="specs"><li>205–212°F</li><li>Steep 3–5 min</li></ul><p>Body.</p>',
    );
    expect(sections[0].specs).toEqual(["205–212°F", "Steep 3–5 min"]);
    expect(sections[0].html).toBe("<p>Body.</p>");
  });

  it("leaves an ordinary ul in the section html", () => {
    const { sections } = parsePageHtml("<h2>Methods</h2><ul><li>Standard</li></ul>");
    expect(sections[0].specs).toEqual([]);
    expect(sections[0].html).toBe("<ul><li>Standard</li></ul>");
  });

  it("extracts the product slug from figure.blend and removes the figure", () => {
    const { sections } = parsePageHtml(
      '<h2>Black Teas</h2><p>Body.</p><figure class="blend"><a href="/product/clearly-calendula-morning">Morning</a></figure>',
    );
    expect(sections[0].productSlug).toBe("clearly-calendula-morning");
    expect(sections[0].html).toBe("<p>Body.</p>");
  });

  it("ignores a figure.blend whose link is not a product URL", () => {
    const { sections } = parsePageHtml(
      '<h2>Black Teas</h2><figure class="blend"><a href="https://example.com">Nope</a></figure>',
    );
    expect(sections[0].productSlug).toBeNull();
  });

  it("extracts blockquotes into callouts and removes them from the html", () => {
    const { sections } = parsePageHtml("<h2>Black Teas</h2><p>Body.</p><blockquote>Still safe to drink.</blockquote>");
    expect(sections[0].callouts).toEqual(["Still safe to drink."]);
    expect(sections[0].html).toBe("<p>Body.</p>");
  });

  it("normalizes before parsing, so bold questions become sections", () => {
    const { sections } = parsePageHtml("<p><strong>Are Your Teas Organic?</strong></p><p>Yes.</p><p>&nbsp;</p>");
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe("Are Your Teas Organic?");
    expect(sections[0].html).toBe("<p>Yes.</p>");
  });

  it("ignores h2-looking text inside an attribute", () => {
    const { sections } = parsePageHtml('<p title="<h2>fake</h2>">Body.</p>');
    expect(sections).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/cms/page-sections.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cms/page-sections"`

- [ ] **Step 3: Write the implementation**

```ts
// lib/cms/page-sections.ts
/**
 * Parses sanitized CMS page HTML into the structured model the page templates
 * render from. Operating on sanitized output means the markup is already
 * well-formed and allowlisted, so regex scanning is safe here — and the result
 * is only ever re-injected, never used to widen the allowlist.
 */
import { normalizePageHtml } from "./page-html";

export interface PageSection {
  /** Slugified heading, used as the anchor target and rail link. */
  id: string;
  heading: string;
  /** Section body with the extracted conventions removed. */
  html: string;
  /** Chip labels lifted from `<ul class="specs">`. */
  specs: string[];
  /** Product slug lifted from `<figure class="blend">`, for the shoppable column. */
  productSlug: string | null;
  /** Plain-text callouts lifted from `<blockquote>`. */
  callouts: string[];
}

export interface ParsedPage {
  /** Text of a leading `<p><strong>Last Updated:</strong> …</p>`, for the legal pill. */
  updatedLabel: string | null;
  /** Hero lede, promoted out of the body when the page has an intro paragraph. */
  lede: string | null;
  /** Remaining content before the first `<h2>`. */
  lead: string;
  sections: PageSection[];
}

const H2_SPLIT = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
const SPECS_LIST = /<ul class="specs">([\s\S]*?)<\/ul>/i;
const BLEND_FIGURE = /<figure class="blend">([\s\S]*?)<\/figure>/gi;
const BLOCKQUOTE = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
const LIST_ITEM = /<li[^>]*>([\s\S]*?)<\/li>/gi;
const FIRST_PARAGRAPH = /<p>([\s\S]*?)<\/p>/i;
const UPDATED_PARAGRAPH = /^\s*<p><strong>Last Updated:<\/strong>([\s\S]*?)<\/p>/i;
const PRODUCT_HREF = /href="\/product\/([a-z0-9-]+)"/i;

function toText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyHeading(text: string): string {
  const slug = toText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/** Pulls the conventions out of a section body, returning the cleaned html. */
function extractConventions(html: string): Omit<PageSection, "id" | "heading"> {
  let body = html;

  const specs: string[] = [];
  const specsMatch = body.match(SPECS_LIST);
  if (specsMatch) {
    for (const item of specsMatch[1].matchAll(LIST_ITEM)) {
      specs.push(toText(item[1]));
    }
    body = body.replace(SPECS_LIST, "");
  }

  let productSlug: string | null = null;
  body = body.replace(BLEND_FIGURE, (_match, inner: string) => {
    const href = inner.match(PRODUCT_HREF);
    if (href) productSlug = href[1];
    return "";
  });

  const callouts: string[] = [];
  body = body.replace(BLOCKQUOTE, (_match, inner: string) => {
    callouts.push(toText(inner));
    return "";
  });

  return { html: body.trim(), specs, productSlug, callouts };
}

export function parsePageHtml(
  html: string,
  options: { promoteLede?: boolean } = {},
): ParsedPage {
  const { promoteLede = true } = options;
  const normalized = normalizePageHtml(html);

  // Split on top-level h2 boundaries.
  const boundaries: { heading: string; start: number; end: number }[] = [];
  for (const match of normalized.matchAll(H2_SPLIT)) {
    boundaries.push({
      heading: toText(match[1]),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }

  let lead = boundaries.length ? normalized.slice(0, boundaries[0].start) : normalized;

  const usedIds = new Map<string, number>();
  const sections: PageSection[] = boundaries.map((boundary, index) => {
    const next = boundaries[index + 1];
    const body = normalized.slice(boundary.end, next ? next.start : undefined);

    const base = slugifyHeading(boundary.heading);
    const seen = (usedIds.get(base) ?? 0) + 1;
    usedIds.set(base, seen);

    return {
      id: seen === 1 ? base : `${base}-${seen}`,
      heading: boundary.heading,
      ...extractConventions(body),
    };
  });

  // Lift a leading "Last Updated" line into its own field (legal pages).
  let updatedLabel: string | null = null;
  const updatedMatch = lead.match(UPDATED_PARAGRAPH);
  if (updatedMatch) {
    updatedLabel = `Last Updated:${updatedMatch[1]}`.replace(/\s+/g, " ").trim();
    lead = lead.slice(updatedMatch[0].length);
  }

  // Promote the first remaining paragraph to the hero lede.
  let lede: string | null = null;
  if (promoteLede) {
    const first = lead.match(FIRST_PARAGRAPH);
    if (first) {
      lede = toText(first[1]);
      lead = lead.replace(first[0], "");
    }
  }

  return { updatedLabel, lede, lead: lead.trim(), sections };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/cms/page-sections.test.ts`
Expected: PASS — 17 tests

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add lib/cms/page-sections.ts tests/unit/lib/cms/page-sections.test.ts
git commit -m "feat(cms): parse page HTML into a typed section model"
```

---

### Task 3: Template resolution

Maps a page's `template` column onto its layout, eyebrow, rail setting, and CTA — the single source of truth for the approved microcopy.

**Files:**
- Create: `lib/cms/page-template.ts`
- Test: `tests/unit/lib/cms/page-template.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  type PageTemplateKind = "guide" | "faq" | "contact" | "legal" | "story";
  interface PageCtaAction { label: string; href: string; variant: "primary" | "secondary" }
  interface PageCtaConfig { heading: string; body: string; actions: PageCtaAction[]; showPolicyLinks: boolean }
  interface PageTemplateConfig { kind: PageTemplateKind; eyebrow: string; showRail: boolean; cta: PageCtaConfig | null }
  resolveTemplate(template: string | null | undefined): PageTemplateConfig
  shouldShowRail(config: PageTemplateConfig, sectionCount: number): boolean
  POLICY_LINKS: { label: string; href: string }[]
  MIN_SECTIONS_FOR_RAIL: number
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/lib/cms/page-template.test.ts
import { describe, it, expect } from "vitest";
import { resolveTemplate, shouldShowRail, POLICY_LINKS } from "@/lib/cms/page-template";

describe("resolveTemplate", () => {
  it("maps each known template to its kind and approved eyebrow", () => {
    expect(resolveTemplate("guide")).toMatchObject({ kind: "guide", eyebrow: "CARE GUIDE" });
    expect(resolveTemplate("faq")).toMatchObject({ kind: "faq", eyebrow: "GOOD QUESTIONS" });
    expect(resolveTemplate("legal")).toMatchObject({ kind: "legal", eyebrow: "THE FINE PRINT" });
    expect(resolveTemplate("contact")).toMatchObject({ kind: "contact", eyebrow: "SAY HELLO" });
    expect(resolveTemplate("story")).toMatchObject({ kind: "story", eyebrow: "OUR STORY" });
  });

  it("falls back to story for unknown, legacy, null, and undefined templates", () => {
    for (const value of ["default", "about", "nonsense", null, undefined]) {
      expect(resolveTemplate(value).kind).toBe("story");
    }
  });

  it("gives contact no CTA because the page is itself a CTA", () => {
    expect(resolveTemplate("contact").cta).toBeNull();
  });

  it("shows policy links only on the legal CTA", () => {
    expect(resolveTemplate("legal").cta?.showPolicyLinks).toBe(true);
    expect(resolveTemplate("guide").cta?.showPolicyLinks).toBe(false);
  });

  it("uses the approved guide CTA copy and destinations", () => {
    const cta = resolveTemplate("guide").cta;
    expect(cta?.heading).toBe("Ready to brew?");
    expect(cta?.body).toBe("Explore the Clearly Calendula collection.");
    expect(cta?.actions).toEqual([
      { label: "Shop the teas", href: "/category/clearly-calendula", variant: "primary" },
      { label: "Ask Chai", href: "/agent", variant: "secondary" },
    ]);
  });

  it("enables the rail only for guide, faq and legal", () => {
    expect(resolveTemplate("guide").showRail).toBe(true);
    expect(resolveTemplate("faq").showRail).toBe(true);
    expect(resolveTemplate("legal").showRail).toBe(true);
    expect(resolveTemplate("contact").showRail).toBe(false);
    expect(resolveTemplate("story").showRail).toBe(false);
  });
});

describe("shouldShowRail", () => {
  it("requires both the template opt-in and at least three sections", () => {
    expect(shouldShowRail(resolveTemplate("guide"), 4)).toBe(true);
    expect(shouldShowRail(resolveTemplate("guide"), 3)).toBe(true);
    expect(shouldShowRail(resolveTemplate("guide"), 2)).toBe(false);
    expect(shouldShowRail(resolveTemplate("story"), 9)).toBe(false);
  });
});

describe("POLICY_LINKS", () => {
  it("lists the four policy pages", () => {
    expect(POLICY_LINKS.map((l) => l.href)).toEqual([
      "/shipping-policy",
      "/refund-policy",
      "/privacy-policy",
      "/terms-of-service",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/cms/page-template.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/cms/page-template"`

- [ ] **Step 3: Write the implementation**

```ts
// lib/cms/page-template.ts
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

export const POLICY_LINKS = [
  { label: "Shipping Policy", href: "/shipping-policy" },
  { label: "Refund & Returns", href: "/refund-policy" },
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Service", href: "/terms-of-service" },
];

const SHOP: PageCtaAction = {
  label: "Shop the teas",
  href: "/category/clearly-calendula",
  variant: "primary",
};

const TEMPLATES: Record<PageTemplateKind, PageTemplateConfig> = {
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
};

export function resolveTemplate(template: string | null | undefined): PageTemplateConfig {
  if (template && template in TEMPLATES) {
    return TEMPLATES[template as PageTemplateKind];
  }
  // `default` and the legacy `about` template both land here.
  return TEMPLATES.story;
}

export function shouldShowRail(config: PageTemplateConfig, sectionCount: number): boolean {
  return config.showRail && sectionCount >= MIN_SECTIONS_FOR_RAIL;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/cms/page-template.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add lib/cms/page-template.ts tests/unit/lib/cms/page-template.test.ts
git commit -m "feat(cms): add page template configuration with approved microcopy"
```

---

### Task 4: Hero, rail and CTA components

The three chrome pieces shared by every template.

**Files:**
- Create: `components/pages/PageHero.tsx`
- Create: `components/pages/PageRail.tsx`
- Create: `components/pages/PageCta.tsx`

**Interfaces:**
- Consumes: `PageCtaConfig`, `POLICY_LINKS` from Task 3; `PageSection` from Task 2.
- Produces:
  ```tsx
  <PageHero eyebrow={string} title={string} lede={string | null} />
  <PageRail sections={PageSection[]} label={string} />       // label defaults to "On this page"
  <PageCta config={PageCtaConfig} />
  ```

- [ ] **Step 1: Write PageHero**

```tsx
// components/pages/PageHero.tsx
/**
 * Tinted hero band shown at the top of every CMS page. Uniform across
 * templates so the pages read as one set — the eyebrow is the only part that
 * varies, and it comes from the template config.
 */
interface PageHeroProps {
  eyebrow: string;
  title: string;
  lede: string | null;
}

export default function PageHero({ eyebrow, title, lede }: PageHeroProps) {
  return (
    <div className="bg-gradient-to-br from-[#f9e6e0] to-[#f5ecdb] border-b border-secondary-400/35">
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-secondary-700">
          {eyebrow}
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl md:text-[46px] font-semibold tracking-tight leading-[1.08] text-[#3a231e] mt-3 mb-3">
          {title}
        </h1>
        {lede && (
          <p className="text-lg sm:text-xl leading-relaxed text-[#6a4a42] max-w-[58ch]">
            {lede}
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write PageRail**

```tsx
// components/pages/PageRail.tsx
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
```

- [ ] **Step 3: Write PageCta**

```tsx
// components/pages/PageCta.tsx
import Link from "next/link";
import { POLICY_LINKS, type PageCtaConfig } from "@/lib/cms/page-template";

/**
 * Closing band. Every page ends with a next step rather than trailing off into
 * whitespace — legal pages additionally surface their sibling policies.
 */
interface PageCtaProps {
  config: PageCtaConfig;
}

export default function PageCta({ config }: PageCtaProps) {
  return (
    <div className="bg-gradient-to-br from-[#f7e3dc] to-[#f3ead9] border-t border-secondary-400/35 mt-4">
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 text-center">
        <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#3a231e] mb-2">
          {config.heading}
        </h2>
        {config.body && <p className="text-base sm:text-lg text-[#6a4a42] mb-6">{config.body}</p>}
        <div className="flex flex-wrap gap-3 justify-center">
          {config.actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={
                action.variant === "primary"
                  ? "px-6 py-2.5 rounded-lg bg-primary-500 text-text-inverse hover:bg-primary-600 transition-colors"
                  : "px-6 py-2.5 rounded-lg border border-primary-400 text-primary-700 hover:bg-primary-400 hover:text-text-inverse transition-colors"
              }
            >
              {action.label}
            </Link>
          ))}
        </div>
        {config.showPolicyLinks && (
          <div className="flex flex-wrap gap-2 justify-center mt-6">
            {POLICY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[13.5px] px-3 py-1.5 rounded-full bg-white/60 border border-secondary-400/45 text-secondary-700 hover:bg-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors from `components/pages/*`

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add components/pages/PageHero.tsx components/pages/PageRail.tsx components/pages/PageCta.tsx
git commit -m "feat(cms): add page hero, contents rail and closing CTA components"
```

---

### Task 5: Section card with shoppable column

The card body used by the `guide` template, including the V3 product column.

**Files:**
- Create: `lib/cms/page-products.ts`
- Create: `components/pages/SectionCard.tsx`

**Interfaces:**
- Consumes: `PageSection` from Task 2; `getProductBySlug` from `lib/models/mach/products`; `Money` from `lib/money`.
- Produces:
  ```ts
  interface BlendCardData { slug: string; name: string; price: string | null; imageKey: string }
  resolveSectionBlends(sections: PageSection[]): Promise<Map<string, BlendCardData>>  // keyed by section id
  ```
  ```tsx
  <SectionCard section={PageSection} blend={BlendCardData | undefined} />
  ```

- [ ] **Step 1: Write the blend resolver**

```ts
// lib/cms/page-products.ts
/**
 * Resolves `figure.blend` product references on a CMS page into display data
 * for the shoppable column. Reading from D1 (rather than freezing name and
 * price into page HTML) keeps the guide in sync with the catalog.
 *
 * NOT unit-testable — depends on Cloudflare bindings via the model layer.
 */
import { getProductBySlug } from "@/lib/models/mach/products";
import { Money } from "@/lib/money";
import type { PageSection } from "./page-sections";

export interface BlendCardData {
  slug: string;
  name: string;
  /** Formatted for display, e.g. "$18.00". Null when the product has no price. */
  price: string | null;
  /** Bare R2 object key — the Next image loader turns it into a CDN or /media URL. */
  imageKey: string;
}

/** Product fields are localizable objects in MACH; take the first value. */
function firstValue(field: unknown): string {
  if (typeof field === "string") return field;
  const values = Object.values((field as Record<string, unknown>) ?? {});
  return typeof values[0] === "string" ? values[0] : "";
}

function imageKeyFor(primaryImage: unknown): string {
  try {
    if (!primaryImage) return "placeholder.svg";
    const data =
      typeof primaryImage === "string" && primaryImage.startsWith("{")
        ? JSON.parse(primaryImage)
        : primaryImage;
    const url = (data as { url?: string })?.url;
    return url ? url.replace(/^\//, "") : "placeholder.svg";
  } catch {
    return "placeholder.svg";
  }
}

export async function resolveSectionBlends(
  sections: PageSection[],
): Promise<Map<string, BlendCardData>> {
  const withProducts = sections.filter((section) => section.productSlug);
  const results = await Promise.all(
    withProducts.map(async (section) => {
      try {
        const product = await getProductBySlug(section.productSlug!);
        if (!product) return null;

        const variants = product.variants ?? [];
        const variant =
          variants.find((v) => v.id === product.default_variant_id) ?? variants[0];
        const amount = variant?.price?.amount;
        const currency = variant?.price?.currency ?? "USD";

        return [
          section.id,
          {
            slug: section.productSlug!,
            name: firstValue(product.name),
            price:
              typeof amount === "number" ? Money.fromMinor(amount, currency).format() : null,
            imageKey: imageKeyFor(product.primary_image),
          },
        ] as const;
      } catch {
        // A missing or malformed product must not take the page down — the
        // card simply renders without its column.
        return null;
      }
    }),
  );

  return new Map(results.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
}
```

- [ ] **Step 2: Confirm the Money API matches**

Run: `grep -n "static fromMinor\|format(" lib/money/index.ts lib/money/*.ts | head -20`
Expected: `fromMinor` and `format` exist as used above. If the signature differs (e.g. `fromMinor(amount, { currency })`), adjust the call — do not change `lib/money`.

- [ ] **Step 3: Write SectionCard**

```tsx
// components/pages/SectionCard.tsx
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
              {section.specs.map((spec) => (
                <li
                  key={spec}
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

          {section.callouts.map((callout) => (
            <p
              key={callout}
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
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add lib/cms/page-products.ts components/pages/SectionCard.tsx
git commit -m "feat(cms): add section card with shoppable blend column"
```

---

### Task 6: Template body components

The four content bodies: FAQ accordion, contact grid, legal document, story prose.

**Files:**
- Create: `components/pages/FaqAccordion.tsx`
- Create: `components/pages/ContactGrid.tsx`
- Create: `components/pages/LegalDocument.tsx`
- Create: `components/pages/StoryBody.tsx`

**Interfaces:**
- Consumes: `PageSection`, `ParsedPage` from Task 2.
- Produces:
  ```tsx
  <FaqAccordion sections={PageSection[]} />                                   // "use client"
  <ContactGrid sections={PageSection[]} lead={string} />
  <LegalDocument updatedLabel={string | null} lead={string} sections={PageSection[]} />
  <StoryBody lead={string} sections={PageSection[]} />
  ```

- [ ] **Step 1: Write FaqAccordion**

```tsx
// components/pages/FaqAccordion.tsx
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
```

- [ ] **Step 2: Write ContactGrid**

```tsx
// components/pages/ContactGrid.tsx
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
  { match: /hour|time|support/i, Icon: Clock },
  { match: /order|shipping|delivery|return/i, Icon: Package },
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
```

- [ ] **Step 3: Write LegalDocument**

```tsx
// components/pages/LegalDocument.tsx
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
```

- [ ] **Step 4: Write StoryBody**

```tsx
// components/pages/StoryBody.tsx
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
```

- [ ] **Step 5: Verify, lint and commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors

```bash
git add components/pages/FaqAccordion.tsx components/pages/ContactGrid.tsx components/pages/LegalDocument.tsx components/pages/StoryBody.tsx
git commit -m "feat(cms): add faq, contact, legal and story page bodies"
```

---

### Task 7: Rewrite PageRenderer as a server component

Wires everything together and moves sanitization server-side.

**Files:**
- Create: `components/pages/CustomPageAssets.tsx`
- Rewrite: `app/[slug]/PageRenderer.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–6; `sanitizePageHtmlServer` from `lib/utils/sanitize-html-server`.
- Produces: `<PageRenderer page={PageSelect} customJsEnabled={boolean} />` — same props as today, so `app/[slug]/page.tsx` needs no change.

- [ ] **Step 1: Extract the custom CSS/JS effects into a client component**

This preserves the BMC-163 kill switch behaviour exactly — `custom_js` runs only when `customJsEnabled` is explicitly `true`.

```tsx
// components/pages/CustomPageAssets.tsx
"use client";

import { useEffect } from "react";

/**
 * Client-side injection of admin-authored per-page CSS/JS.
 *
 * Split out of PageRenderer so that component can be a server component. The
 * BMC-163 guardrail is unchanged: `custom_js` is executed via `new Function()`
 * ONLY when `customJsEnabled` is explicitly true, so a missing or omitted flag
 * never runs the code.
 */
interface CustomPageAssetsProps {
  pageId: number;
  customCss: string | null;
  customJs: string | null;
  customJsEnabled: boolean;
}

export default function CustomPageAssets({
  pageId,
  customCss,
  customJs,
  customJsEnabled,
}: CustomPageAssetsProps) {
  useEffect(() => {
    if (!customCss) return;
    const styleElement = document.createElement("style");
    styleElement.id = `page-${pageId}-styles`;
    styleElement.textContent = customCss;
    document.head.appendChild(styleElement);
    return () => {
      document.getElementById(`page-${pageId}-styles`)?.remove();
    };
  }, [customCss, pageId]);

  useEffect(() => {
    if (!customJsEnabled || !customJs) return;
    try {
      new Function(customJs)();
    } catch (error) {
      console.error("Error executing custom JavaScript for page:", error);
    }
  }, [customJs, customJsEnabled]);

  return null;
}
```

- [ ] **Step 2: Rewrite PageRenderer**

```tsx
// app/[slug]/PageRenderer.tsx
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
import { resolveSectionBlends } from "@/lib/cms/page-products";
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
  const parsed = parsePageHtml(sanitized, { promoteLede: !page.excerpt });
  const lede = page.excerpt || parsed.lede;

  const blends =
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
        return <FaqAccordion sections={parsed.sections} />;
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
```

- [ ] **Step 3: Verify the whole suite and types still pass**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — all existing unit tests plus the 33 added in Tasks 1–3

- [ ] **Step 4: Lint and commit**

```bash
npm run lint
git add app/\[slug\]/PageRenderer.tsx components/pages/CustomPageAssets.tsx
git commit -m "refactor(cms): render CMS pages server-side through the template system"
```

---

### Task 8: Move page images to R2

Three Shopify-hosted images whose `src` the sanitizer already strips, so they do not render today.

**Files:**
- Create: `scripts/migrate-page-images.ts`
- Modify: `package.json` (add the `images:pages` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: R2 objects `pages/about-us-vanity-ritual.jpg`, `pages/brewing-iced-tea-pour.jpg`, `pages/subscriptions-vanity-flatlay.jpg` in both `beauteas-images` and `beauteas-images-dev`.

- [ ] **Step 1: Write the script**

```ts
// scripts/migrate-page-images.ts
/**
 * Copies the CMS page images still hosted on the old Shopify CDN into R2.
 *
 * These images do not currently render: the sanitizer only permits image
 * sources under https://img.beauteas.com/ or relative paths, so a
 * cdn.shopify.com `src` is stripped at render time. Once uploaded they are
 * served through the existing /media/[...key] R2 proxy route.
 *
 * Usage:  npx tsx scripts/migrate-page-images.ts [--env dev|production]
 * Re-runnable: existing keys are skipped.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IMAGES = [
  {
    source:
      "https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6329_e90889c6-2175-4c97-ab75-96eac46c1115_1024x1024.jpg?v=1626361061",
    key: "pages/about-us-vanity-ritual.jpg",
  },
  {
    source: "https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6494_1024x1024.jpg?v=1625358797",
    key: "pages/brewing-iced-tea-pour.jpg",
  },
  {
    source: "https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6547_1024x1024.jpg?v=1625358249",
    key: "pages/subscriptions-vanity-flatlay.jpg",
  },
];

const BUCKETS = {
  dev: "beauteas-images-dev",
  production: "beauteas-images",
} as const;

function wrangler(args: string[]): string {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });
}

async function main() {
  const envArg = process.argv.indexOf("--env");
  const env = (envArg > -1 ? process.argv[envArg + 1] : "dev") as keyof typeof BUCKETS;
  const bucket = BUCKETS[env];
  if (!bucket) throw new Error(`Unknown env "${env}" — expected dev or production`);

  const workDir = mkdtempSync(join(tmpdir(), "page-images-"));

  for (const image of IMAGES) {
    try {
      wrangler(["r2", "object", "get", `${bucket}/${image.key}`, "--remote", "--pipe"]);
      console.log(`skip   ${image.key} (already in ${bucket})`);
      continue;
    } catch {
      // Not present — fall through and upload.
    }

    const response = await fetch(image.source);
    if (!response.ok) {
      throw new Error(`Failed to download ${image.source}: HTTP ${response.status}`);
    }
    const localPath = join(workDir, image.key.replace("/", "-"));
    writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));

    wrangler([
      "r2", "object", "put", `${bucket}/${image.key}`,
      "--file", localPath,
      "--content-type", "image/jpeg",
      "--remote",
    ]);
    console.log(`upload ${image.key} → ${bucket}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, alongside the other `token:*` scripts:

```json
"images:pages": "tsx scripts/migrate-page-images.ts"
```

- [ ] **Step 3: Run against dev and verify**

```bash
npm run images:pages -- --env dev
curl -s -o /dev/null -w "%{http_code}\n" https://beauteas-dev.<your-workers-subdomain>.workers.dev/media/pages/brewing-iced-tea-pour.jpg
```
Expected: `200`. If the wrangler `r2 object get` existence probe misbehaves on your CLI version, replace it with `npx wrangler r2 object info` and re-run — the script must stay re-runnable.

- [ ] **Step 4: Run against production**

```bash
npm run images:pages -- --env production
```
Expected: three `upload` lines, then `skip` on a second run.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add scripts/migrate-page-images.ts package.json
git commit -m "feat(cms): copy Shopify-hosted page images into R2"
```

---

### Task 9: Data migration 0019

Sets templates and ledes, adds the convention markup to Brewing Directions, repoints image URLs, and retires the duplicate About page.

**Files:**
- Create: `migrations/0019_restructure_footer_pages.sql`

**Interfaces:**
- Consumes: R2 keys from Task 8; template names from Task 3.
- Produces: `pages.template` set for 9 rows, `pages.excerpt` set for 3 rows, `about` archived, one `redirect_map` row.

- [ ] **Step 1: Confirm the redirect_map column names before writing the insert**

Run: `npx wrangler d1 execute beauteas-db-dev --remote --env dev --command "SELECT sql FROM sqlite_master WHERE name='redirect_map'"`
Expected: the CREATE TABLE statement. Use its exact column names in Step 2 — do not guess.

- [ ] **Step 2: Write the migration**

Note on quoting: the content below contains apostrophes; every one is doubled (`''`) for SQL. The `updated_at` bump is deliberate so admin listings show the change.

```sql
-- Migration: 0019_restructure_footer_pages
--
-- Applies the Structured Guide design to the footer-linked CMS pages.
--
-- Deliberately minimal: Shopify cruft removal and FAQ heading promotion happen
-- at render time in lib/cms/page-html.ts, so this migration only sets what
-- cannot be derived — the template column, ledes for pages with no intro
-- paragraph, the additive convention markup on Brewing Directions, the R2
-- image URLs, and retirement of the duplicate About page.
--
-- Idempotent. Guards use short LIKE patterns because D1 rejects LIKE patterns
-- over 50 characters ("LIKE or GLOB pattern too complex"). Every statement
-- tolerates a missing row: dev has no `about` page, prod does.

-- Snapshot every page we are about to touch (mirrors the 0016 pattern).
INSERT INTO page_versions (page_id, version, title, content, excerpt, created_at, created_by)
SELECT id, version, title, content, excerpt, CURRENT_TIMESTAMP, 'migration-0019'
FROM pages
WHERE slug IN (
  'brewing-directions', 'faq', 'contact', 'subscriptions', 'about-us', 'about',
  'shipping-policy', 'refund-policy', 'privacy-policy', 'terms-of-service'
);

-- ── Templates ────────────────────────────────────────────────────────────────
UPDATE pages SET template = 'guide'   WHERE slug = 'brewing-directions';
UPDATE pages SET template = 'faq'     WHERE slug = 'faq';
UPDATE pages SET template = 'contact' WHERE slug = 'contact';
UPDATE pages SET template = 'story'   WHERE slug IN ('about-us', 'subscriptions');
UPDATE pages SET template = 'legal'
  WHERE slug IN ('shipping-policy', 'refund-policy', 'privacy-policy', 'terms-of-service');

-- ── Ledes for the three pages with no intro paragraph of their own ───────────
-- Brewing Directions, Contact, About Us, Subscriptions, Privacy and Terms all
-- open with a real intro paragraph, which the renderer promotes automatically.
UPDATE pages SET excerpt = 'Ingredients, caffeine, brewing and subscriptions — the things people ask us most.'
  WHERE slug = 'faq' AND excerpt IS NULL;
UPDATE pages SET excerpt = 'How and when your order gets to you.'
  WHERE slug = 'shipping-policy' AND excerpt IS NULL;
UPDATE pages SET excerpt = 'What to do if something isn''t right.'
  WHERE slug = 'refund-policy' AND excerpt IS NULL;

-- ── Brewing Directions: add specs chips, blend links and callouts ────────────
-- Full replacement rather than a chain of REPLACE() calls. The words are
-- unchanged; the caveats move into <blockquote> and the blends are linked.
-- Guard is short: D1 caps LIKE patterns at 50 characters.
UPDATE pages SET
  content = '<p>Brewing your tea correctly will help ensure that it tastes delicious and that you are getting the most benefits from the organic herbs and flowers in our tea blends.  Don''t stress out over the precise temperatures, or freak out if you let it steep a little too long, these are just guidelines to help you get the most out of your tea.</p>
<h2>Black Teas</h2>
<ul class="specs"><li>205–212°F water</li><li>Steep 3–5 minutes</li></ul>
<p>For Black teas, like our Clearly Calendula Morning, which is an Earl Grey based tea, we recommend using water that is between 205 and 212 degrees Fahrenheit.</p>
<p>It''s best to boil water, and then let it cool for 30 seconds or so before pouring it into your tea cup.  But you can use boiling water if you''re in a rush:)</p>
<p>Add the tea bag to the hot water in the cup, and let it steep for 3-5 minutes, before removing the tea bag.</p>
<blockquote>If you let it steep too long the tea can taste too strong and slightly bitter (it''s still safe to drink).</blockquote>
<figure class="blend"><a href="/product/clearly-calendula-morning">Clearly Calendula Morning</a></figure>
<h2>Green Teas</h2>
<ul class="specs"><li>175°F water</li><li>Steep 2–4 minutes</li></ul>
<p>For Green teas, like our Clearly Calendula Afternoon, which is a Green tea, we recommend using water that is around 175 degrees Fahrenheit.</p>
<p>It''s best to boil water, and then let it cool for 3 minutes or so before pouring it into your tea cup.  Or you can get a kettle which allows you to set the target temperature for 175 degrees.</p>
<p>Add the tea bag to the hot water in the cup, and let it steep for 2-4 minutes, before removing the tea bag.</p>
<blockquote>If you let it steep too long the tea can taste too strong and slightly bitter (it''s still safe to drink).</blockquote>
<figure class="blend"><a href="/product/clearly-calendula-afternoon">Clearly Calendula Afternoon</a></figure>
<h2>Herbal Teas</h2>
<ul class="specs"><li>212°F water</li><li>Steep 5+ minutes</li></ul>
<p>For Herbal teas, like our Clearly Calendula Evening, which is a herbal tea, we recommend using water that is around 212 degrees Fahrenheit.</p>
<p>It''s best to boil water, and immediately pour it into your tea cup.</p>
<p>Add the tea bag to the hot water in the cup, and let it steep for at least 5 minutes, you don''t have to remove the tea bag.</p>
<blockquote>Generally letting herbal teas steep longer can make them taste a little stronger, but they won''t become bitter or unpleasant to drink.</blockquote>
<figure class="blend"><a href="/product/clearly-calendula-evening">Clearly Calendula Evening</a></figure>
<h2>Iced Teas</h2>
<ul class="specs"><li>Cold brew 2+ hours</li><li>1 bag per 8–16 oz</li></ul>
<p>Iced tea can be a super refreshing way to drink your tea, especially in warm weather, or at the gym.  Luckily it''s easy to make!  You can easily brew up a large amount of tea, using multiple tea bags in a pitcher.  Generally you will want one bag for every 8-16 oz of water, depending on how strong you like it.</p>
<p><img src="/media/pages/brewing-iced-tea-pour.jpg" alt="Pouring freshly brewed iced tea into a travel bottle"></p>
<p>Black teas must be hot brewed, using the directions above, and then chilled.  It''s usually best to let the hot tea cool to room temperature on your counter, and then move it into the refrigerator.</p>
<p>For Green and Herbal teas, you can hot brew, and then chill like with Black teas. However you can also cold brew these teas as well, which might be easier.  Cold brewing is basically just adding your tea bags to cold water, and letting it steep for at least two hours and up to several days.</p>
<p>You can do this inside a water bottle, mason jar, or large pitcher.  You can drink it with ice, or just chilled from the fridge.</p>
<p>Play around with amounts and timing to figure out what you like best!</p>',
  version = version + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE slug = 'brewing-directions' AND content NOT LIKE '%class="blend"%';

-- ── Repoint the remaining Shopify images at R2 ──────────────────────────────
UPDATE pages SET
  content = replace(
    content,
    'https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6329_e90889c6-2175-4c97-ab75-96eac46c1115_1024x1024.jpg?v=1626361061',
    '/media/pages/about-us-vanity-ritual.jpg'
  ),
  version = version + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE slug = 'about-us' AND content LIKE '%85A6329%';

UPDATE pages SET
  content = replace(
    content,
    'https://cdn.shopify.com/s/files/1/0554/7288/1831/files/85A6547_1024x1024.jpg?v=1625358249',
    '/media/pages/subscriptions-vanity-flatlay.jpg'
  ),
  version = version + 1,
  updated_at = CURRENT_TIMESTAMP
WHERE slug = 'subscriptions' AND content LIKE '%85A6547%';

-- ── Retire the duplicate About placeholder ──────────────────────────────────
-- `about` is the generic page seeded by 0003 ("an AI-powered eCommerce
-- platform"); `about-us` holds the real founder story. Prod has both, dev has
-- only `about-us`, so this is a no-op where the row is absent.
UPDATE pages SET status = 'archived', show_in_nav = 0 WHERE slug = 'about';
```

- [ ] **Step 3: Append the redirect using the column names from Step 1**

Using the real schema (typical shape shown; substitute the actual columns):

```sql
INSERT OR IGNORE INTO redirect_map (source_path, target_path, status_code)
VALUES ('/about', '/about-us', 301);
```

- [ ] **Step 4: Apply locally and verify**

```bash
npx wrangler d1 migrations apply beauteas-db-dev --local --env dev
npx wrangler d1 execute beauteas-db-dev --local --env dev \
  --command "SELECT slug, template, substr(coalesce(excerpt,'-'),1,40) FROM pages ORDER BY slug"
```
Expected: `brewing-directions|guide`, `faq|faq`, `contact|contact`, `about-us|story`, the four policies `legal`.

- [ ] **Step 5: Re-run to prove idempotency, then commit**

```bash
npx wrangler d1 execute beauteas-db-dev --local --env dev --file migrations/0019_restructure_footer_pages.sql
npx wrangler d1 execute beauteas-db-dev --local --env dev \
  --command "SELECT count(*) FROM pages WHERE slug='brewing-directions' AND content LIKE '%class=\"blend\"%'"
```
Expected: `1` — the second run changes nothing. Then:

```bash
git add migrations/0019_restructure_footer_pages.sql
git commit -m "feat(cms): set page templates, ledes and blend links (0019)"
```

---

### Task 10: Point the footer at the real About page

**Files:**
- Modify: `lib/brand.config.ts:132`

**Interfaces:**
- Consumes: the archived `about` page from Task 9.
- Produces: no code interface change.

- [ ] **Step 1: Change the href**

In `lib/brand.config.ts`, `footerLinks.column2`:

```ts
      { label: "About Us", href: "/about-us" },            // CMS page (real founder story)
```

replacing:

```ts
      { label: "About Us", href: "/about" },               // CMS page (published)
```

- [ ] **Step 2: Confirm the footer no longer duplicates the link**

`components/Footer.tsx` filters CMS nav pages against the curated hrefs, so `/about-us` must now be excluded from column 1 rather than `/about`.

Run: `grep -n "curatedHrefs" -A 6 components/Footer.tsx`
Expected: the filter compares `/${page.slug}` against the curated set — no change needed, it now matches `about-us` automatically.

- [ ] **Step 3: Lint and commit**

```bash
npm run lint
git add lib/brand.config.ts
git commit -m "fix(cms): point footer About Us at the real story page"
```

---

### Task 11: Apply to remote environments and verify

**Files:** none (operational).

- [ ] **Step 1: Apply the migration to remote dev, dev preview, and production**

```bash
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev
npx wrangler d1 migrations apply beauteas-db-dev --remote --env dev --preview
npx wrangler d1 migrations apply beauteas-db     --remote --env production
```

- [ ] **Step 2: Confirm the templates landed in production**

```bash
npx wrangler d1 execute beauteas-db --remote --env production \
  --command "SELECT slug, template, status FROM pages WHERE slug IN ('brewing-directions','faq','contact','about','about-us','shipping-policy')"
```
Expected: `guide`, `faq`, `contact`, `about → archived`, `about-us → story`, `shipping-policy → legal`.

- [ ] **Step 3: Run the full gate**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```
Expected: all pass.

- [ ] **Step 4: Visual check on the Workers runtime**

Plain `npm run dev` 500s on D1-backed routes, so use the Workers preview:

```bash
npm run preview:dev
```

Walk every footer link and confirm:
- `/brewing-directions` — four cards, chips, blend columns on the first three, iced-tea photo in the fourth, rail with four entries
- `/faq` — accordion, first answer open, rail lists the questions
- `/contact` — info grid, no rail, no CTA band
- `/shipping-policy`, `/refund-policy`, `/privacy-policy`, `/terms-of-service` — one continuous card, "Last Updated" pill, rail, CTA with policy pills
- `/about-us` and `/subscriptions` — story layout, photo rendering from `/media/pages/…`
- `/about` — 301s to `/about-us`
- `/gift-cards` — unchanged

- [ ] **Step 5: Deploy**

```bash
npm run deploy:dev
```
Then spot-check the same URLs on the dev Worker before promoting to production with `npm run deploy:production`.

---

## Self-Review

**Spec coverage:** hero/rail/card/chips/callout/shoppable-column/CTA → Tasks 4–6; server-component architecture → Task 7; `lib/cms/page-sections.ts` and `page-template.ts` → Tasks 2–3; content conventions → Tasks 2 and 9; template assignment table → Task 9; migration 0019 → Task 9; image migration → Task 8; footer fix → Task 10; tests → Tasks 1–3; risks (idempotency, `page_versions` snapshot, LIKE cap, dev/prod divergence) → Task 9 constraints.

**Three spec items intentionally changed**, documented under "Deviations" above: cruft removal moved to render time, the `p.updated` convention dropped in favour of the existing "Last Updated" markup, and only three pages need a written lede rather than five.

**Type consistency:** `PageSection` / `ParsedPage` as defined in Task 2 are consumed unchanged in Tasks 4–7. `PageTemplateConfig` / `PageCtaConfig` from Task 3 are consumed unchanged in Tasks 4 and 7. `BlendCardData` from Task 5 is consumed by `SectionCard` and keyed by section id in Task 7. `resolveTemplate`, `shouldShowRail`, `parsePageHtml`, `normalizePageHtml`, `slugifyHeading`, `resolveSectionBlends` are spelled identically everywhere they appear.

**Known verification points** flagged inline rather than assumed: the `Money.fromMinor` signature (Task 5 Step 2), the `redirect_map` column names (Task 9 Step 1), and the wrangler `r2 object get` existence probe (Task 8 Step 3).
