# Footer Nav Page Design — Design Spec

**Date:** 2026-07-27
**Status:** Approved direction, pending implementation plan

## Problem

The CMS-driven pages linked from the footer (`/brewing-directions`, `/faq`, `/contact`,
`/subscriptions`, `/about`, and the four policy pages) are readable but generic. They all render
through one undifferentiated path in `app/[slug]/PageRenderer.tsx`: a large serif `<h1>`, a line of
publication metadata, and then `dangerouslySetInnerHTML` into a `prose` block on flat cream.

Concretely, what makes them read as low quality:

1. **No visual entry point.** No hero, no accent, no imagery, no rhythm — the page begins at a
   title and immediately becomes body copy.
2. **Stale migration metadata.** "Published June 24, 2021 · Updated July 3, 2021 · Version 2" sits
   under the title of evergreen content, making it look like an abandoned blog post.
3. **Dead vertical space.** Migrated Shopify HTML contains `<p>&nbsp;</p>` and
   `<div style="display:none">` runs, producing ~120px voids between sections.
4. **Over-wide measure.** `max-w-4xl` (896px) of 16px serif yields ~110-character lines.
5. **Content shape ignored.** FAQ questions are `<p><strong>…</strong></p>` rather than headings, so
   nothing is scannable or linkable. Brewing Directions contains four temperature/steep recipes
   rendered as undifferentiated prose.
6. **Dead ends.** Only the `legal` template renders a closing block; `default` pages end in
   whitespace with no next step.
7. **No brand presence** beyond the Lora/Alegreya pairing — the blush and honey palette never
   appears.

Two defects surfaced during review that are in scope because they affect the same pages:

- The footer's **About Us** link points to `/about`, a generic seeded placeholder ("BeauTeas is an
  AI-powered eCommerce platform…"). The real founder story lives at `/about-us` and is unlinked.
  Both rows exist in production; only `about-us` exists in dev.
- Three page bodies hotlink `cdn.shopify.com` images. The sanitizer
  (`lib/utils/sanitize-html-core.ts`) only permits `https://img.beauteas.com/` or relative `src`
  values, so **those images are already being stripped and do not render today.**

## Goals

- Every footer-linked CMS page looks deliberately designed and brand-consistent.
- The design lives in the renderer, so future CMS pages inherit it with no extra work.
- Admins keep authoring plain HTML in the existing CMS editor.
- Page copy is preserved verbatim; only markup, structure, and a small amount of new
  framing microcopy change.

## Non-goals

- `/gift-cards` — a real route, already well designed. Untouched.
- Blog, product, category, and account pages.
- Header navigation.
- Rewriting or re-voicing page copy.
- Changing the sanitizer allowlist (the design is deliberately built within it).

## Approved visual system

Chosen through visual review (options A/B/C → **B**, hero B1–B4 → **B2**, card image V1–V3 → **V3**).

**Structured Guide.** A warm hero band, a sticky contents rail, and content in white cards on cream.

- **Hero (B2):** full-bleed `linear-gradient(135deg, #f9e6e0, #f5ecdb)` band, bottom-bordered
  `rgba(196,168,124,.35)`. Contains an uppercase letterspaced honey eyebrow, the page title in
  Lora, and a lede paragraph. Uniform across every page — no per-page image dependency.
- **Rail:** sticky "On this page" list, left border `#e8d5cf`, active item `#cf8577` border with
  `#99544a` text. Rendered only when the page has 3+ sections and the template opts in.
- **Card:** `#fff`, `1px solid #e8d5cf`, `12px` radius,
  `0 1px 2px rgba(122,80,66,.05), 0 8px 22px -14px rgba(122,80,66,.22)`.
- **Chips:** honey `#f3e9d6` fill, `#94733f` text, `rgba(196,168,124,.5)` border, pill radius.
- **Callout:** cream fill, `3px` left border `#dfa699`, right-rounded.
- **Shoppable column (V3):** 168px right column inside a card — product photo, name in Lora, price,
  and a "Shop this blend" link into the PDP.
- **Closing CTA:** blush→honey gradient band with a heading, one line of copy, buttons, and (on
  legal pages) a row of sibling-policy pills.

Body measure is capped at ~66 characters. Page content column is `max-w-[900px]` including the rail.

## Architecture

`PageRenderer` currently sanitizes and injects HTML on the client. It becomes a **server component**
that parses sanitized HTML into a structured section model and hands typed data to presentational
components. This gives us server-rendered headings and rail (good for SEO and no hydration flash),
and removes client-side DOMPurify from these routes.

### New modules

| File | Responsibility |
|---|---|
| `lib/cms/page-sections.ts` | Pure functions over sanitized HTML — no DOM, fully unit-testable |
| `lib/cms/page-template.ts` | `resolveTemplate(page)` → template config (kind, eyebrow, rail, CTA) |
| `components/pages/PageHero.tsx` | B2 tinted hero band |
| `components/pages/PageRail.tsx` | Sticky contents rail |
| `components/pages/SectionCard.tsx` | White card: heading, chips, prose, callouts, shoppable column |
| `components/pages/FaqAccordion.tsx` | Client component — expand/collapse rows |
| `components/pages/ContactGrid.tsx` | 2-up info grid for short pages |
| `components/pages/LegalDocument.tsx` | Single continuous card for dense policy text |
| `components/pages/PageCta.tsx` | Closing gradient CTA band |
| `components/pages/CustomPageAssets.tsx` | Client component holding the existing `custom_css` / `custom_js` effects |

`app/[slug]/PageRenderer.tsx` is rewritten as the server-side orchestrator. The BMC-163 `custom_js`
kill switch behaviour is preserved exactly and moves into `CustomPageAssets`.

### `lib/cms/page-sections.ts`

```ts
interface PageSection {
  id: string;        // slugified heading, de-duplicated with -2, -3 suffixes
  heading: string;   // plain text
  html: string;      // section body, conventions already extracted out
  specs: string[];   // chip labels
  productSlug?: string;
  callouts: string[];
}

interface ParsedPage {
  lead: string;          // html before the first <h2>
  sections: PageSection[];
  updatedLabel?: string; // text of a leading <p class="updated">
}

parsePageHtml(sanitizedHtml: string): ParsedPage
injectHeadingIds(sanitizedHtml: string): string   // for templates that don't split into cards
```

Splitting is a regex scan for top-level `<h2…>…</h2>` boundaries over **already-sanitized** HTML.
This is safe because sanitization has normalised the markup, and the output is only ever
re-injected — it never widens the allowlist.

### Content conventions

The sanitizer permits `class` on any element and allows `figure`, so all conventions are expressible
without touching the allowlist. Each degrades gracefully to meaningful HTML if the template is
bypassed. `id` is **not** an allowed attribute, so heading anchors are injected by the renderer, not
authored.

| Convention | Renders as |
|---|---|
| `<h2>` | Section / card boundary, rail entry, anchor target |
| `<ul class="specs"><li>205–212°F</li>…</ul>` | Chip row |
| `<blockquote>` | Blush callout |
| `<figure class="blend"><a href="/product/{slug}">Name</a></figure>` | Shoppable column |
| `<p class="updated">Last updated 10 July 2026</p>` | "Last updated" pill (legal only) |
| `<img src="/media/pages/…">` | Full-width rounded inline image |

The shoppable column resolves the product **server-side from D1** by the slug in the `figure.blend`
anchor, so name, price, and photo stay in sync with the catalog. If lookup fails, the card renders
without a column (and the anchor still degrades to a working link).

### Templates

| Template | Layout | Rail | Pages |
|---|---|---|---|
| `guide` | Hero → rail + section cards → CTA | yes | `brewing-directions` |
| `faq` | Hero → rail + accordion → CTA | yes | `faq` |
| `contact` | Hero → 2-up info grid, no rail | no | `contact` |
| `legal` | Hero → rail + one continuous card + updated pill → CTA w/ sibling policy links | yes | `shipping-policy`, `refund-policy`, `privacy-policy`, `terms-of-service` |
| `story` | Hero → single wide card, large inline images → CTA | no | `about-us`, `subscriptions` |
| `default` | Falls back to `story` behaviour | no | any future page |

Contact grid icons come from a small keyword→icon map in `page-template.ts` with a neutral default.

## Data migration (`migrations/0019_restructure_footer_pages.sql`)

Data-only, idempotent, following the 0016 pattern (snapshot into `page_versions` before updating).
`0011`–`0018` are taken; the two `0010` files stay as they are.

Per page it will:

1. Strip Shopify residue — `<div style="display:none">`, `<p>&nbsp;</p>`, `<meta charset>`, inline
   `style` attributes.
2. Convert FAQ `<p><strong>Question?</strong></p>` to `<h2>`, and add `<h2>` structure where a page
   has implicit sections.
3. Add the convention markup — `ul.specs` for brewing temps/times, `figure.blend` for
   Morning/Afternoon/Evening, `blockquote` for the "still safe to drink" caveats, `p.updated` for
   policy dates.
4. Rewrite the three `cdn.shopify.com` image URLs to `/media/pages/…`.
5. Move each page's natural intro paragraph into `excerpt` (the hero lede) and remove it from the body.
6. Set `template` per the table above.
7. Set `about` to `archived` and insert a `redirect_map` row `/about` → `/about-us`.

**Guards.** Per CLAUDE.md, D1 caps LIKE patterns at 50 characters — every idempotency guard must use
a short substring. Per prior experience, the dev `pages` table diverges from prod (dev has no
`about` row), so every statement must tolerate a missing row rather than assuming `UPDATE` matches.

Apply order: local → remote dev → dev preview → production.

## Image migration

Three images, all currently reachable at 1024×683, all real brand photography worth keeping:

| Source | R2 key | Used by |
|---|---|---|
| `85A6329_…_1024x1024.jpg` | `pages/about-us-vanity-ritual.jpg` | `about-us` |
| `85A6494_1024x1024.jpg` | `pages/brewing-iced-tea-pour.jpg` | `brewing-directions` → **Iced Teas** section |
| `85A6547_1024x1024.jpg` | `pages/subscriptions-vanity-flatlay.jpg` | `subscriptions` |

`scripts/migrate-page-images.ts` (tsx, mirroring the existing `scripts/shopify-migration` style)
downloads each source and uploads to both `beauteas-images` and `beauteas-images-dev`. It is
re-runnable and skips keys that already exist. Serving is via the existing `/media/[...key]` R2
proxy route, whose relative path satisfies the sanitizer.

The iced-tea pour currently sits orphaned at the end of the Brewing Directions body; the migration
relocates it into the **Iced Teas** section, which is the one section with no blend to merchandise.

## Footer fix

`lib/brand.config.ts` — `footerLinks.column2` "About Us" href changes `/about` → `/about-us`.

## Testing

CI gates lint + tsc + `tests/unit/**` + build, so the parsing logic is covered unit-style:

`tests/unit/lib/cms/page-sections.test.ts`
- splits on top-level `<h2>`, ignores `<h2>` nested in other elements
- content before the first `<h2>` becomes `lead`
- heading ids are slugified and de-duplicated
- extracts `ul.specs`, `figure.blend` slug, `blockquote`, `p.updated` out of section html
- content with zero `<h2>` yields one lead and no sections
- `injectHeadingIds` is idempotent

`tests/unit/lib/cms/page-template.test.ts`
- each slug resolves to the expected template, eyebrow, and rail setting
- unknown template falls back to `story` behaviour

Visual verification is manual via `npm run preview:dev` (plain `next dev` 500s on D1 routes).
`npm run lint` before completion.

## Open items needing your sign-off

The direction preserves all page copy, but the design introduces framing microcopy that does not
exist in the current content. These are the only new words:

**1. Hero eyebrows** (one per template):

| Template | Eyebrow |
|---|---|
| `guide` | CARE GUIDE |
| `faq` | HELP |
| `legal` | POLICIES |
| `contact` | GET IN TOUCH |
| `story` | OUR STORY |

**2. Ledes.** Brewing Directions, Contact, About Us, and Subscriptions each have a natural intro
paragraph that becomes the lede with no new words. Five pages have no intro paragraph and need one
line written, or they run with no lede:

- FAQ
- Shipping Policy
- Refund & Return Policy
- Privacy Policy
- Terms of Service

**3. CTA blocks.** Per template — e.g. FAQ → "Still have a question? / We answer every email within
1–2 business days." Legal → "Need a hand? / If anything here is unclear, we are happy to explain."

Proposed wording for all three will be listed in the implementation plan for approval before it
lands in a migration.

## Risks

- The migration rewrites production page content. Mitigated by snapshotting every page into
  `page_versions` first (the 0016 precedent) and by idempotent guards.
- Regex-based section splitting is looser than a real parser. Mitigated by operating only on
  sanitized output and by unit tests covering nesting and malformed input.
- Moving `PageRenderer` to a server component changes where sanitization happens. The server
  allowlist (`sanitize-html-core.ts`) is already the authoritative gate, so this is a tightening,
  not a loosening — but the two allowlists must stay in sync as the comments require.
