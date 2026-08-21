/**
 * === Chat Store ===
 *
 * Zustand store for managing conversation state with the Chai AI assistant.
 * Provides persistent storage for chat history, product recommendations,
 * and conversation context across browser sessions.
 *
 * === Features ===
 * - **Persistent Storage**: Chat history survives browser refreshes
 * - **Message Management**: Add, update, and clear conversation messages
 * - **Product Integration**: Track recommended products from AI responses
 * - **Type Safety**: Fully typed with TypeScript interfaces
 * - **Performance**: Efficient state updates with Zustand
 *
 * === Storage Strategy ===
 * Uses localStorage with 'chat-storage' key to persist conversations.
 * Automatically rehydrates state on app initialization.
 *
 * === Usage ===
 * ```tsx
 * const { messages, addMessage, products } = useChatStore();
 * ```
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Product } from "@/lib/types";

/**
 * Represents a single chat message in the conversation
 */
export type ChatMessage = {
  role?: "user" | "assistant";
  content: string;
  created_at: string;
  productIds?: string[]; // Optional product IDs associated with this message
};

/**
 * How long a stored conversation may be replayed before it is dropped on load.
 *
 * A transcript is a record of something that happened, so it survives a reload
 * — but a month-old one describes a catalog and a set of prices that no longer
 * exist ("the Sample Pack is a lovely place to start"), and during a closing
 * sale that gap only widens. A week keeps the continuity that persistence was
 * added for and expires the rest.
 */
export const MAX_PERSISTED_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The messages worth restoring: those written within MAX_PERSISTED_AGE_MS.
 *
 * A message whose `created_at` cannot be parsed is dropped rather than kept —
 * it carries no evidence of being recent, and this is a cache, not a record of
 * record.
 */
export function freshMessages(messages: unknown, now: number): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter((message) => {
    const written = Date.parse((message as ChatMessage)?.created_at ?? "");
    return Number.isFinite(written) && now - written < MAX_PERSISTED_AGE_MS;
  });
}

/**
 * What rehydration is allowed to restore.
 *
 * Deliberately NOT the product cards. `products` holds full product objects —
 * name, price, stock — captured from one server response, and localStorage has
 * no expiry, so a card rendered before the closing sale kept rendering forever:
 * the archived Sample Pack at its old $24.00, on every page load, with no
 * request made and therefore nothing for the server's purchasability filters
 * (agent-chat's dropWithdrawnMatches and its card-level filter) to catch. A
 * price and an availability are only true at the moment they are fetched, so
 * they are session state, not persisted state, and come back on the next turn.
 */
export function mergePersistedChat<T extends ChatState>(persisted: unknown, current: T, now: number): T {
  return {
    ...current,
    messages: freshMessages((persisted as { messages?: unknown })?.messages, now),
    productIds: [],
    products: [],
  };
}

/**
 * Chat store state interface defining all available state and actions
 */
interface ChatState {
  // === State ===
  messages: ChatMessage[];        // Complete conversation history
  productIds: string[];          // Currently displayed product IDs
  products: Product[];           // Full product objects for recommendations
  
  // === Actions ===
  addMessage: (msg: ChatMessage) => void;              // Add new message to conversation
  setAssistantMessage: (msg: ChatMessage) => void;     // Update last assistant message
  setProductIds: (ids: string[]) => void;              // Update displayed product IDs
  setProducts: (products: Product[]) => void;          // Update product recommendations
  clearMessages: () => void;                           // Clear entire conversation
}

/**
 * Chat store with persistent storage
 * 
 * Automatically saves conversation state to localStorage and restores
 * it on page reload to maintain conversation continuity.
 */
export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      // Initial state
      messages: [],
      productIds: [],
      products: [],
      
      // Add new message to conversation history
      addMessage: (msg) => set({ messages: [...get().messages, msg] }),
      
      // Update the last assistant message (for streaming updates)
      setAssistantMessage: (msg) =>
        set({
          messages: [...get().messages.slice(0, -1), msg],
        }),
      setProductIds: (ids) => set({ productIds: ids }),
      setProducts: (products) => set({ products }),
      clearMessages: () => set({ messages: [], productIds: [], products: [] }),
    }),
    {
      name: "chat-storage",
      // v1 exists to expire the v0 blobs that already sit in customers'
      // browsers holding pre-sale product cards; `merge` runs on every load,
      // so the same rule applies to anything written since.
      version: 1,
      partialize: (state) => ({ messages: state.messages }),
      migrate: (persisted) => ({
        messages: Array.isArray((persisted as { messages?: unknown })?.messages)
          ? ((persisted as { messages: ChatMessage[] }).messages)
          : [],
      }),
      merge: (persisted, current) => mergePersistedChat(persisted, current, Date.now()),
    }
  )
);

export const getMessages = () => {
  return useChatStore.getState().messages;
};

export const addMessage = (msg: ChatMessage) => {
  useChatStore.getState().addMessage(msg);
};

export const clearMessages = () => {
  useChatStore.getState().clearMessages();
};
