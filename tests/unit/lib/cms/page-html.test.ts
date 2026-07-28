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

  it("drops empty divs after style attribute removal", () => {
    const html = '<div style="text-align: left;"></div><p>Copy.</p>';
    expect(normalizePageHtml(html)).toBe("<p>Copy.</p>");
  });

  it("preserves divs with content (like images) but strips style attribute", () => {
    const html = '<div style="text-align: center;"><img src="/media/pages/x.jpg" alt=""></div>';
    expect(normalizePageHtml(html)).toBe('<div><img src="/media/pages/x.jpg" alt=""></div>');
  });

  it("preserves divs containing text", () => {
    const html = '<div style="text-align: left;">Important info</div>';
    expect(normalizePageHtml(html)).toBe("<div>Important info</div>");
  });
});
