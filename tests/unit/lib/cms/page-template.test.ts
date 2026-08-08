import { describe, it, expect } from "vitest";
import {
  resolveTemplate,
  shouldShowRail,
  parseTemplateKind,
  TEMPLATE_KINDS,
  POLICY_LINKS,
} from "@/lib/cms/page-template";

describe("resolveTemplate", () => {
  it("maps each known template to its kind and approved eyebrow", () => {
    expect(resolveTemplate("guide")).toMatchObject({ kind: "guide", eyebrow: "CARE GUIDE" });
    expect(resolveTemplate("faq")).toMatchObject({ kind: "faq", eyebrow: "GOOD QUESTIONS" });
    expect(resolveTemplate("legal")).toMatchObject({ kind: "legal", eyebrow: "THE FINE PRINT" });
    expect(resolveTemplate("contact")).toMatchObject({ kind: "contact", eyebrow: "SAY HELLO" });
    expect(resolveTemplate("story")).toMatchObject({ kind: "story", eyebrow: "OUR STORY" });
    expect(resolveTemplate("closing")).toMatchObject({ kind: "closing", eyebrow: "THANK YOU" });
  });

  it("falls back to story for unknown, legacy, null, and undefined templates", () => {
    for (const value of ["default", "about", "nonsense", null, undefined]) {
      expect(resolveTemplate(value).kind).toBe("story");
    }
  });

  it("gives contact no CTA because the page is itself a CTA", () => {
    expect(resolveTemplate("contact").cta).toBeNull();
  });

  it("gives closing no CTA, and drops the subscriptions action from story's", () => {
    // GOOB: subscriptions are off for the closing sale, so neither the
    // dedicated closing page nor the shared story CTA should point at it.
    expect(resolveTemplate("closing").cta).toBeNull();
    expect(resolveTemplate("story").cta?.actions).toEqual([
      { label: "Shop the teas", href: "/category/clearly-calendula", variant: "primary" },
    ]);
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
    expect(resolveTemplate("closing").showRail).toBe(false);
  });

  it("rejects Object.prototype keys like constructor, toString, valueOf", () => {
    // Covers both lookups: the kind list and the legacy-alias map. An object
    // literal for either would resolve these off the prototype chain.
    expect(resolveTemplate("constructor").kind).toBe("story");
    expect(resolveTemplate("constructor").eyebrow).toBe("OUR STORY");
    expect(resolveTemplate("toString").kind).toBe("story");
    expect(resolveTemplate("valueOf").kind).toBe("story");
    expect(resolveTemplate("hasOwnProperty").kind).toBe("story");
  });

  it("maps the legacy default and about templates onto story", () => {
    expect(parseTemplateKind("default")).toBe("story");
    expect(parseTemplateKind("about")).toBe("story");
  });

  it("returns null for values that are neither a kind nor a legacy alias", () => {
    expect(parseTemplateKind("guide")).toBe("guide");
    expect(parseTemplateKind("nonsense")).toBeNull();
    expect(parseTemplateKind("constructor")).toBeNull();
    expect(parseTemplateKind(null)).toBeNull();
    expect(parseTemplateKind(undefined)).toBeNull();
  });

  it("keeps TEMPLATE_KINDS in step with the configured templates", () => {
    // The dropdown seeded by migration 0020 is built from this list; drift here
    // means an admin cannot select a template that the renderer supports.
    expect([...TEMPLATE_KINDS].sort()).toEqual(
      ["closing", "contact", "faq", "guide", "legal", "story"],
    );
    for (const kind of TEMPLATE_KINDS) {
      expect(resolveTemplate(kind).kind).toBe(kind);
    }
  });

  it("returns a frozen CTA structure that cannot be mutated", () => {
    const config = resolveTemplate("guide");

    // Verify the CTA and its actions array are both frozen
    expect(Object.isFrozen(config.cta)).toBe(true);
    expect(Object.isFrozen(config.cta?.actions)).toBe(true);
    // Verify nested action objects are also frozen
    expect(Object.isFrozen(config.cta?.actions[0])).toBe(true);

    // Attempt to mutate the actions array; should throw in strict mode
    expect(() => {
      (config.cta!.actions as unknown as unknown[]).push({
        label: "Malicious",
        href: "/malicious",
        variant: "primary",
      });
    }).toThrow();

    // Attempt to mutate a nested action property; should throw in strict mode
    expect(() => {
      (config.cta!.actions[0] as any).label = "Hacked";
    }).toThrow();
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

  it("is frozen and cannot be mutated", () => {
    // Verify the POLICY_LINKS array itself is frozen
    expect(Object.isFrozen(POLICY_LINKS)).toBe(true);
    // Verify each individual policy link object is also frozen
    expect(Object.isFrozen(POLICY_LINKS[0])).toBe(true);
    expect(Object.isFrozen(POLICY_LINKS[3])).toBe(true);

    // Attempt to mutate the array; should throw in strict mode
    expect(() => {
      (POLICY_LINKS as unknown[]).push({ label: "Malicious", href: "/malicious" });
    }).toThrow();

    // Attempt to mutate a nested policy link property; should throw in strict mode
    expect(() => {
      (POLICY_LINKS[0] as any).href = "https://malicious.com";
    }).toThrow();
  });
});
