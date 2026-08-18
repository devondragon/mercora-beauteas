/**
 * What Chai's chat store is allowed to restore from localStorage.
 *
 * The bug this pins down: `products` (full product objects, with price and
 * stock) was persisted under `chat-storage` with no expiry and no version, so
 * a recommendation card rendered before the closing sale kept rendering on
 * every page load - the archived Clearly Calendula Sample Pack at its pre-sale
 * $24.00. Reproduced on production by seeding the key and opening the drawer:
 * no request is made on rehydrate, so neither of agent-chat's purchasability
 * filters (dropWithdrawnMatches, and the card-level filter before the response)
 * ever sees it. The fix is that a price/availability snapshot is session state,
 * not persisted state.
 *
 * These are the two pure seams the persist config is wired to, so the rules can
 * be asserted without a DOM or a storage mock.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_PERSISTED_AGE_MS,
  freshMessages,
  mergePersistedChat,
} from "@/lib/stores/chat-store";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function message(created_at: string, content = "hello") {
  return { role: "assistant" as const, content, created_at };
}

function currentState() {
  return {
    messages: [],
    productIds: [],
    products: [],
    addMessage: () => {},
    setAssistantMessage: () => {},
    setProductIds: () => {},
    setProducts: () => {},
    clearMessages: () => {},
  };
}

describe("freshMessages", () => {
  it("keeps messages written inside the window", () => {
    const recent = message(ago(60_000));
    expect(freshMessages([recent], NOW)).toEqual([recent]);
  });

  it("drops messages older than the window", () => {
    const stale = message(ago(MAX_PERSISTED_AGE_MS + 1), "The Sample Pack is a lovely place to start!");
    expect(freshMessages([stale], NOW)).toEqual([]);
  });

  it("keeps the fresh half of a mixed transcript", () => {
    const stale = message(ago(MAX_PERSISTED_AGE_MS * 2));
    const recent = message(ago(1000));
    expect(freshMessages([stale, recent], NOW)).toEqual([recent]);
  });

  it("drops a message whose timestamp cannot be parsed", () => {
    // No evidence of being recent, and this is a cache rather than a record.
    expect(freshMessages([message("not a date")], NOW)).toEqual([]);
    expect(freshMessages([{ role: "assistant", content: "x" }], NOW)).toEqual([]);
  });

  it("tolerates a corrupt or absent stored value", () => {
    expect(freshMessages(undefined, NOW)).toEqual([]);
    expect(freshMessages(null, NOW)).toEqual([]);
    expect(freshMessages("[]", NOW)).toEqual([]);
    expect(freshMessages({ messages: [] }, NOW)).toEqual([]);
  });
});

describe("mergePersistedChat", () => {
  it("never restores persisted product cards, however recent", () => {
    const persisted = {
      messages: [message(ago(1000))],
      productIds: ["prod_clearly_calendula_sample_pack"],
      products: [
        {
          id: "prod_clearly_calendula_sample_pack",
          name: "Clearly Calendula Sample Pack",
          status: "archived",
        },
      ],
    };

    const merged = mergePersistedChat(persisted, currentState(), NOW);

    expect(merged.products).toEqual([]);
    expect(merged.productIds).toEqual([]);
    expect(merged.messages).toHaveLength(1);
  });

  it("restores the transcript inside the window and expires the rest", () => {
    const persisted = {
      messages: [message(ago(MAX_PERSISTED_AGE_MS + 1)), message(ago(1000))],
    };

    expect(mergePersistedChat(persisted, currentState(), NOW).messages).toHaveLength(1);
  });

  it("keeps the store's actions intact while replacing its data", () => {
    const merged = mergePersistedChat({ messages: [] }, currentState(), NOW);

    expect(typeof merged.addMessage).toBe("function");
    expect(typeof merged.clearMessages).toBe("function");
  });

  it("survives a v0 blob with no messages key at all", () => {
    const merged = mergePersistedChat({ products: [{ id: "x" }] }, currentState(), NOW);

    expect(merged.messages).toEqual([]);
    expect(merged.products).toEqual([]);
  });
});
