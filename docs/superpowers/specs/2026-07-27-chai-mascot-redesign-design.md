# Chai Mascot Redesign — Design Spec

**Date:** 2026-07-27
**Status:** Implemented (uncommitted at time of writing)

> Written after the artwork settled rather than before it. The visual decisions
> could only be judged by looking at rendered pixels, so the build ran first and
> this records what we actually shipped and why.

## 1. Problem

Chai — the storefront AI assistant — had no real mascot. `public/chai.svg` was a
flat teacup badge with no character, and the branding-debt note in `CLAUDE.md`
still pointed at `data/r2/volt.svg`, a 2MB base64-PNG character render inherited
from the Voltique fork and referenced by nothing.

The chat voice is a warm "beauty bestie". The mark was a generic icon. The ask
was a mascot with personality that still works at chat-avatar size.

## 2. Goals / Non-Goals

**Goals**
- A character mark with a face, legible from 128px down to 16px.
- Built from `lib/brand.config.ts` tokens so it tracks the storefront palette.
- Replace every existing Chai reference; delete the dead `volt.svg`.

**Non-Goals**
- A painterly/rendered illustration. No image-generation tool was available;
  everything here is hand-authored SVG.
- Rebranding the site favicon (see §7 — this turned out to already be done).
- The placeholder outdoor-gear content in `data/r2/products_md/*.md`, which the
  Shopify ETL replaces at cutover.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Form | Teacup with a face | Reads as "tea" instantly; simplest silhouette to keep legible small |
| Style | Soft outline + fill | Storybook/sticker warmth suits the bestie voice |
| Container | Free-standing (no badge disc) | Asymmetric silhouette is recognisable in peripheral vision |
| Assets | Two, split by rendered size | One asset cannot serve both 128px charm and 16px legibility |
| Expression | Calm smile, no wink | Copy already carries the personality; a wink on top tips into cloying |

**Unified outline colour.** Every element — including the sage leaves — is
outlined in `primary.700` rather than a per-element darker shade. A green leaf
outlined in terracotta looks deliberate in flat illustration and holds the mark
together as one object.

## 4. Palette

All values from `lib/brand.config.ts`; no raw hex was invented.

| Element | Token | Hex |
|---|---|---|
| Cup + saucer fill | `primary.500` | `#cf8577` |
| All outlines | `primary.700` | `#99544a` |
| Rim band | `primary.200` | `#f3dcd4` |
| Blush cheeks | `primary.300` | `#ebc3bb` |
| Leaves | `state.success` | `#446b52` |
| Steam + calendula bud | `secondary.400` | `#c4a87c` |
| Eyes + smile | `primary.900` | `#6a3d38` |

Eyes use warm dark `#6a3d38`, not black — black reads cold on the cream surface
and breaks the palette.

## 5. The two assets

### `public/chai.svg` — full character (48×48 viewBox)
Calendula bud, sprig of two leaves, two steam wisps, handle, tapered cup body,
rim band, blush cheeks, eyes, smile, saucer. Strokes 1.6. Used at **32px+**.

### `public/chai-mark.svg` — simplified (24×24 viewBox)
Drops steam, bud, second leaf and cheeks; enlarges the eyes relative to the body
and thickens strokes so they survive downscaling. Used at **20–24px**.

**Pick by rendered size, not by context.** The full character mushes below ~32px.

### Why the mark needed its own drawing
The first attempt reused one asset. At 20px it read as an **acorn**: a narrow
body with a vertical leaf-stem on top is a nut silhouette. The fix was to lean on
the three cues that actually signal "teacup" when small — a prominent **handle**,
a **saucer**, and a **wide shallow body** — and to make the leaf small and angled
rather than a vertical stem.

It was drawn to survive **16px**, on the original plan of swapping the desktop
launcher's `h-4 w-4` magnifier too. That swap was dropped (§6), so the smallest
size actually shipped is **20px**. The extra headroom is deliberate — it is what
lets the mark be dropped into a smaller slot later without redrawing.

## 6. Integration

| File | Rendered at | Asset |
|---|---|---|
| `components/agent/AgentDrawer.tsx` | 40px empty state | `chai.svg` |
| `components/agent/AgentDrawer.tsx` | 20px message avatar | `chai-mark.svg` |
| `components/admin/ProductEditor.tsx` | 24px AI button | `chai-mark.svg` |
| `app/admin/knowledge/KnowledgeManagement.tsx` | 24px AI button | `chai-mark.svg` |
| `components/HeaderClient.tsx` | 20px mobile launcher | `chai-mark.svg` |

**Launcher: mobile only.** The launcher is not a floating action button — it is a
nav control labelled "Help & Search" in two places. Swapping the magnifier costs
the search affordance, so Chai replaces it only on the mobile row (20px, with a
full-width label carrying the meaning). The desktop header keeps the magnifier,
where a 16px face would read as noise.

`AgentDrawer`'s `variant="mobile"` branch is **dead code** — the prop is never
passed; `HeaderClient.tsx` renders its own row. The live change belongs there.
Removing the magnifier left `Search` unused in `HeaderClient` and it was dropped
from the import.

## 7. The favicon — investigated, then deliberately not changed

Originally scoped as "create a favicon from the logo", on the belief that none
existed. **That belief was wrong.** `app/icon.png` (512²), `app/apple-icon.png`
(180², already on a cream tile) and `app/favicon.ico` were committed on 1 Jul in
`1cff6ab feat(brand): use logo mark for favicon and app icons`.

The false reading came from a zsh glob (`ls app/icon* … public/favicon*`) that
aborts the entire line when any pattern fails to match — it produced no output
because it never ran, and the silence was read as absence.

A simplified redraw was built anyway before this was caught. It is **not
shipped**, and shipping it would have been a regression rather than an addition:
Next emits `app/icon.svg` as `rel="icon" type="image/svg+xml"`, which modern
browsers prefer over `icon.png`, so a cruder redraw would have *replaced* the
real emblem in most browsers. The redraw is parked outside the repo.

Findings worth keeping from that work:

- The emblem is a **symmetric seven-petal lotus**, 201×120 px (aspect 1.68:1),
  with a right-facing profile inside the central teardrop and hair drawn as ~14
  fine strands. Gradient `#cc1290` → `#872490`.
- **Nothing legible survives at 16px** — plain downscale, dilation,
  morphological close and solid-fill were all tested and all produce an
  indistinguishable smudge. This is inherent to the mark's hairline
  construction, not a defect of any particular treatment. Retina (32 device px)
  is what saves it in practice.
- `app/favicon.ico` contains an **RGB-mode PNG frame**, which Next's dev image
  processor rejects (`Format error decoding Ico: The PNG is not in RGBA
  format!`). **Dev-only** — `npm run build` succeeds and all three icons emit.
  Worth fixing eventually; not a cutover blocker.

## 8. Bug found: mascot broken in every deployed environment

`image-loader.ts` routed **every** image except `/placeholder*` and `/logo*`
through R2 (`/media/<key>` in dev, `https://img.beauteas.com/<key>` in prod).
`/chai.svg` is bundled in `public/`, so the loader sent it to R2, where no such
object exists — the mascot rendered as a broken image in dev and prod.

It went unnoticed because the loader short-circuits under `next dev`:

```ts
if (process.env.NODE_ENV === "development") return src;
```

so it always worked locally. Caught only by viewing the drawer on the Workers
runtime (`npm run preview:dev`). Fixed by adding `/chai` to the bypass list.

**Generalisation:** any new `public/`-bundled image needs a bypass entry in
`image-loader.ts`, and bundled-asset changes must be verified under
`preview:dev` — plain `next dev` cannot catch this class of bug.

## 9. Also changed

`lib/seo/json-ld.tsx:239` — Organization `logo` moved from `/favicon.ico` to
`/logo.png`. A 48px favicon is a poor Organization logo; `logo.png` is 692×120.

Note the original justification was wrong: this was flagged as a 404, but
`/favicon.ico` resolves. The change stands on its merits alone and is the one
edit here unrelated to the mascot — safe to revert independently.

## 10. Verification

- SVGs rendered at 16/20/24/40/64/128px across cream, white and rose.
- Chat drawer and mobile menu confirmed on the Workers runtime (`preview:dev`),
  after the broken-image bug was found and fixed.
- `npm run lint` clean (3 pre-existing `no-img-element` warnings in blog files).
- `npx tsc --noEmit` clean. `npm run build` succeeds; `favicon.ico`, `icon.png`
  and `apple-icon.png` all emit.

## 11. Files touched

```
public/chai.svg                              rewritten
public/chai-mark.svg                         new
data/r2/volt.svg                             deleted (2MB, zero references)
image-loader.ts                              /chai bypass
components/HeaderClient.tsx                  mobile launcher + unused import
components/agent/AgentDrawer.tsx             20px avatar → chai-mark
components/admin/ProductEditor.tsx           → chai-mark
app/admin/knowledge/KnowledgeManagement.tsx  → chai-mark
lib/seo/json-ld.tsx                          Organization logo
CLAUDE.md                                    branding-debt note closed
```

## 12. Out of scope

- Site favicon / app icons — already correct (§7).
- `app/favicon.ico` RGB→RGBA re-encode — dev-only noise.
- Outdoor-gear placeholder content in `data/r2/products_md/` — ETL replaces it.
- Any change to `logo.png` itself, or reconciling the logo's magenta/purple
  gradient with the storefront's blush/cream palette. Noted, not actioned.
