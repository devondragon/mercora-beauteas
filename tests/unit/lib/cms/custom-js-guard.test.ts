import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CUSTOM_JS_ENABLED_SETTING,
  isCustomJsEnabled,
  customJsChanged,
  logCustomJsAudit,
} from "@/lib/cms/custom-js-guard";

describe("isCustomJsEnabled (kill switch)", () => {
  it("defaults OFF when the setting is absent", () => {
    expect(isCustomJsEnabled({})).toBe(false);
  });

  it("is ON only for an explicit boolean true", () => {
    expect(isCustomJsEnabled({ [CUSTOM_JS_ENABLED_SETTING]: true })).toBe(true);
  });

  it("is OFF for an explicit false", () => {
    expect(isCustomJsEnabled({ [CUSTOM_JS_ENABLED_SETTING]: false })).toBe(false);
  });

  it("does NOT treat truthy non-boolean values as enabled (secure by default)", () => {
    expect(isCustomJsEnabled({ [CUSTOM_JS_ENABLED_SETTING]: "true" })).toBe(false);
    expect(isCustomJsEnabled({ [CUSTOM_JS_ENABLED_SETTING]: 1 })).toBe(false);
    expect(isCustomJsEnabled({ [CUSTOM_JS_ENABLED_SETTING]: {} })).toBe(false);
  });
});

describe("customJsChanged (super-admin write gate predicate)", () => {
  it("returns false when the payload does not include custom_js", () => {
    expect(customJsChanged({ title: "x" } as any, { custom_js: "alert(1)" })).toBe(false);
  });

  it("returns true when creating with a non-empty custom_js (no current row)", () => {
    expect(customJsChanged({ custom_js: "alert(1)" }, null)).toBe(true);
    expect(customJsChanged({ custom_js: "alert(1)" }, undefined)).toBe(true);
  });

  it("returns false when creating with an empty/whitespace custom_js", () => {
    expect(customJsChanged({ custom_js: "" }, null)).toBe(false);
    expect(customJsChanged({ custom_js: "   " }, null)).toBe(false);
    expect(customJsChanged({ custom_js: null }, null)).toBe(false);
  });

  it("returns true when the value actually changes", () => {
    expect(customJsChanged({ custom_js: "b()" }, { custom_js: "a()" })).toBe(true);
  });

  it("returns false for a no-op re-save of the same value", () => {
    expect(customJsChanged({ custom_js: "a()" }, { custom_js: "a()" })).toBe(false);
  });

  it("treats whitespace-only differences as unchanged", () => {
    expect(customJsChanged({ custom_js: "  a()  " }, { custom_js: "a()" })).toBe(true);
    expect(customJsChanged({ custom_js: "" }, { custom_js: null })).toBe(false);
  });

  it("returns true when clearing an existing script", () => {
    expect(customJsChanged({ custom_js: "" }, { custom_js: "a()" })).toBe(true);
    expect(customJsChanged({ custom_js: null }, { custom_js: "a()" })).toBe(true);
  });
});

describe("logCustomJsAudit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits a structured audit record with actor, page and decision", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logCustomJsAudit({ actorUserId: "user_123", pageId: 7, action: "update", allowed: false });

    expect(warn).toHaveBeenCalledTimes(1);
    const [tag, payload] = warn.mock.calls[0];
    expect(tag).toBe("[audit][cms.custom_js]");
    const parsed = JSON.parse(payload as string);
    expect(parsed).toMatchObject({
      event: "cms.custom_js.write",
      action: "update",
      allowed: false,
      actorUserId: "user_123",
      pageId: 7,
    });
    expect(typeof parsed.at).toBe("string");
  });

  it("falls back to safe placeholders for missing actor/page", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logCustomJsAudit({ action: "create", allowed: true });
    const parsed = JSON.parse(warn.mock.calls[0][1] as string);
    expect(parsed.actorUserId).toBe("unknown");
    expect(parsed.pageId).toBeNull();
  });
});
