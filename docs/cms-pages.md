# CMS Pages & Authoring Conventions

Footer-linked pages (`/brewing-directions`, `/faq`, `/contact`, the policy pages, `/about-us`, `/subscriptions`) store plain HTML in D1 and stay admin-editable — the design lives in the renderer, so new pages inherit it.

`app/[slug]/PageRenderer.tsx` sanitizes the stored HTML, parses it into a typed section model (`lib/cms/page-sections.ts`), and renders one of five templates chosen by the `pages.template` column (`lib/cms/page-template.ts`).

---

## Templates

| Template | Layout | Renders conventions? |
|---|---|---|
| `guide` | Sectioned cards, contents rail | ✅ specs, callouts, blend column |
| `faq` | Accordion (a bold paragraph ending in `?` is promoted to a question) | — |
| `contact` | Icon grid | — |
| `legal` | Document with "Last Updated" pill + policy links | — |
| `story` | Long-form narrative + shop CTA. **Also the fallback** for any unrecognized value | — |

## Markup conventions (guide template only)

| Markup | Becomes |
|---|---|
| `<h2>` | section boundary + rail anchor |
| `<ul class="specs">` | spec chips |
| `<blockquote>` | callout |
| `<figure class="blend"><a href="/product/:slug">` | shoppable column with live price |

- **`<h2>` must be at the top level.** A heading nested inside a wrapper element is left inline as ordinary markup — splitting at depth would emit unbalanced HTML into `dangerouslySetInnerHTML`.
- Extra classes and attributes are fine (`class="specs mt-4"`, an `id`) — matching is on the class token.
- Conventions are extracted **only for the template that renders them**. A `<blockquote>` on a legal page stays inline rather than being lifted and dropped.
- An unresolvable `figure.blend` (bad slug, non-product href, or a second figure in one section) is left inline rather than deleted.
- Content images go in as absolute `https://img.beauteas.com/pages/<file>` URLs, matching the blog convention — raw `<img>` inside `dangerouslySetInnerHTML` never passes through `image-loader.ts`, so a relative `/media/` path would bypass the image CDN entirely.

---

## ⚠️ Two "template" registries

`lib/cms/page-template.ts` is the render-time source of truth; the admin editor's Template dropdown is built from the `page_templates` **table**.

Adding a kind to `TEMPLATE_KINDS` must be paired with a `page_templates` INSERT (see migration `0020`), or admins cannot select it and re-saving the page through the editor resets it to the `story` fallback.

## Page images

Content images live in R2 under `pages/`. Upload from the committed `data/r2/pages/` bytes:

```bash
npm run images:pages -- --env dev|production
```

Existing keys are skipped, so it is safe to re-run. Needs `CLOUDFLARE_API_TOKEN`. Run it **before** applying any migration that repoints page markup at `img.beauteas.com`, or those pages render broken images.
