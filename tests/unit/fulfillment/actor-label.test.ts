/**
 * Unit tests for fulfillment-timeline actor labels.
 *
 * The timeline used to render the raw Clerk user id — "By Admin
 * (user_3HI6hxcFuFFXiitdZ5ilNkpD7xC)" — which is opaque to an operator and
 * pushes the useful part of the sentence off screen. `admin_users` already
 * carries `display_name` and `email`, so the events route now resolves admin
 * actors to a human label and the view prefers it.
 *
 * The unresolved case still has to distinguish two different admins, so it
 * degrades to a short id tail rather than dropping the identity entirely.
 */
import { describe, it, expect } from "vitest";
import { formatFulfillmentEvent } from "@/lib/fulfillment/queue-view";

const base = {
  id: "e1",
  type: "shipment_created",
  actorType: "admin",
  actorId: "user_3HI6hxcFuFFXiitdZ5ilNkpD7xC",
  fromStatus: "processing",
  toStatus: "shipped",
  details: null,
  createdAt: "2026-07-31T22:00:00.000Z",
};

describe("actor labels in the fulfillment timeline", () => {
  it("uses the resolved human label when the route supplied one", () => {
    const entry = formatFulfillmentEvent({ ...base, actorLabel: "Devon Hillard" });
    expect(entry.actor).toBe("Admin (Devon Hillard)");
  });

  it("prefers an email over a raw id when that is what resolved", () => {
    const entry = formatFulfillmentEvent({ ...base, actorLabel: "devon@justblackmagic.com" });
    expect(entry.actor).toBe("Admin (devon@justblackmagic.com)");
  });

  it("never renders a full opaque Clerk id", () => {
    const entry = formatFulfillmentEvent(base);
    expect(entry.actor).not.toContain("user_3HI6hxcFuFFXiitdZ5ilNkpD7xC");
  });

  it("keeps enough of an unresolved id to tell two admins apart", () => {
    const a = formatFulfillmentEvent({ ...base, actorId: "user_AAAAAAAAAAAAAAAAAAAAAA1111" });
    const b = formatFulfillmentEvent({ ...base, actorId: "user_AAAAAAAAAAAAAAAAAAAAAA2222" });
    expect(a.actor).not.toBe(b.actor);
  });

  it("leaves a short actor id intact rather than truncating it", () => {
    const entry = formatFulfillmentEvent({ ...base, actorType: "service", actorId: "api-token" });
    expect(entry.actor).toBe("Service token (api-token)");
  });

  it("renders the bare actor type when there is no id at all", () => {
    const entry = formatFulfillmentEvent({ ...base, actorType: "system", actorId: null });
    expect(entry.actor).toBe("System");
  });

  it("ignores a blank resolved label instead of rendering empty parentheses", () => {
    const entry = formatFulfillmentEvent({ ...base, actorLabel: "   " });
    expect(entry.actor).not.toContain("(   )");
    expect(entry.actor).not.toBe("Admin ()");
  });
});
