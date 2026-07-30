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

  it("extracts multiple ul.specs lists and removes all of them from the section html", () => {
    const { sections } = parsePageHtml(
      '<h2>Black Teas</h2><ul class="specs"><li>205–212°F</li></ul><p>Body.</p><ul class="specs"><li>Steep 3–5 min</li></ul>',
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

  it("keeps a figure.blend inline when its link is not a product URL", () => {
    const { sections } = parsePageHtml(
      '<h2>Black Teas</h2><figure class="blend"><a href="https://example.com">Nope</a></figure>',
    );
    expect(sections[0].productSlug).toBeNull();
    // Nothing renders an unresolved blend, so removing it would delete the
    // author's figure outright.
    expect(sections[0].html).toContain("https://example.com");
  });

  it("accepts an absolute product link in a figure.blend", () => {
    const { sections } = parsePageHtml(
      '<h2>Black Teas</h2><figure class="blend"><a href="https://beauteas.com/product/morning-blend">Morning</a></figure>',
    );
    expect(sections[0].productSlug).toBe("morning-blend");
  });

  it("keeps a second figure.blend inline, since only one slug can be represented", () => {
    const { sections } = parsePageHtml(
      '<h2>Black Teas</h2><figure class="blend"><a href="/product/one">One</a></figure>' +
        '<figure class="blend"><a href="/product/two">Two</a></figure>',
    );
    expect(sections[0].productSlug).toBe("one");
    expect(sections[0].html).toContain("/product/two");
  });

  it("matches conventions that carry extra classes or attributes", () => {
    const { sections } = parsePageHtml(
      '<h2>Black Teas</h2><ul class="specs mt-4"><li>205F</li></ul>' +
        '<figure id="f1" class="blend rounded"><a href="/product/morning">Morning</a></figure>',
    );
    expect(sections[0].specs).toEqual(["205F"]);
    expect(sections[0].productSlug).toBe("morning");
    expect(sections[0].html).not.toContain("<ul");
  });

  it("does not split on an h2 nested inside a wrapper element", () => {
    // Splitting at any depth would emit an unclosed <div> as the lead and a
    // stray </div> into the section, straight into dangerouslySetInnerHTML.
    const { lead, sections } = parsePageHtml('<div class="wrap"><h2>Wrapped</h2><p>Body.</p></div>', {
      promoteLede: false,
    });
    expect(sections).toEqual([]);
    expect(lead).toBe('<div class="wrap"><h2>Wrapped</h2><p>Body.</p></div>');
  });

  it("splits on top-level headings while leaving nested ones inline", () => {
    const { sections } = parsePageHtml(
      "<h2>Real</h2><blockquote><h2>Quoted</h2></blockquote><p>Body.</p>",
    );
    expect(sections.map((s) => s.heading)).toEqual(["Real"]);
    expect(sections[0].callouts).toEqual(["Quoted"]);
  });

  it("leaves conventions in the body when extraction is disabled", () => {
    // Only the guide template renders specs/callouts/blends; the others would
    // strip the markup and render nothing in its place.
    const { sections } = parsePageHtml(
      '<h2>Terms</h2><ul class="specs"><li>205F</li></ul><blockquote>Note.</blockquote>',
      { extractConventions: false },
    );
    expect(sections[0].specs).toEqual([]);
    expect(sections[0].callouts).toEqual([]);
    expect(sections[0].html).toContain("<ul");
    expect(sections[0].html).toContain("<blockquote>");
  });

  it("leaves a Last Updated line in the lead when lifting is disabled", () => {
    const { updatedLabel, lead } = parsePageHtml(
      "<p><strong>Last Updated:</strong> July 2026</p><p>Body.</p>",
      { liftUpdatedLabel: false, promoteLede: false },
    );
    expect(updatedLabel).toBeNull();
    expect(lead).toContain("Last Updated:");
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

  it("treats escaped angle brackets in text as content, not headings", () => {
    const { sections } = parsePageHtml("<p>Use &lt;h2&gt; for section titles.</p>");
    expect(sections).toEqual([]);
  });
});
