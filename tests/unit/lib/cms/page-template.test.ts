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
