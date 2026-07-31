/**
 * === Deterministic Answers (BMC-215) ===
 *
 * Some questions have exactly one correct answer, and a language model is the
 * wrong tool for them. "What's your support email?" is not a question about
 * BeauTeas' catalog — it is a lookup, and letting a model generate it means
 * occasionally inventing a plausible-looking mailbox at a misspelled domain.
 *
 * `classifyQuery` runs BEFORE the embedding call in `/api/agent-chat`, so:
 *   - a hit skips retrieval AND generation entirely (faster and cheaper than the
 *     model path it replaces — no embedding, no Vectorize query, no completion);
 *   - a miss costs a handful of regex tests against a length-capped string.
 *
 * Every value in an answer comes from `canonical-facts.ts`, never a literal here.
 *
 * === Scope ===
 * Only categories whose answer is available synchronously from config are
 * handled. Refund windows, shipping costs, and prices are deliberately NOT here:
 * their sources of truth live in D1 (`refund.*` admin settings, the checkout
 * charge config, the catalog), so answering them deterministically would make
 * this classifier async and put database reads on the chat hot path. They stay
 * on the retrieval path, where the response guard still prevents them from
 * carrying invented contact details.
 */

import {
  BUSINESS_ADDRESS_LINE,
  CONTACT_EMAIL,
  ORDER_HISTORY_URL,
  SUPPORT_HOURS,
} from "@/lib/ai/canonical-facts";

/** Identifier for the matched category, surfaced for logging/tests. */
export type DeterministicCategory = "contact_email" | "order_status" | "business_address";

export interface DeterministicAnswer {
  category: DeterministicCategory;
  answer: string;
}

interface CategoryRule {
  category: DeterministicCategory;
  /** Question matches the category if ANY pattern matches. */
  patterns: RegExp[];
  /** Built lazily so the answer always reflects the current canonical value. */
  answer: () => string;
}

/**
 * Ordered — the FIRST matching rule wins.
 *
 * `contact_email` is deliberately first. The phrasing that originally failed in
 * production ("What email address should I use to contact support about my
 * order?") mentions an order, and an order-status rule evaluated earlier would
 * swallow it and answer the wrong question.
 */
const RULES: CategoryRule[] = [
  {
    category: "contact_email",
    patterns: [
      // Any question that names an email address at all.
      /\b(e-?mail)\b.{0,40}\b(address|support|you|us|team|contact|customer service)\b/i,
      /\b(address|support|contact|reach|get in touch|write|message)\b.{0,40}\b(e-?mail)\b/i,
      /\b(what|whats|what's|which|where)\b.{0,30}\b(e-?mail)\b/i,
      // Reaching a human, without the word "email".
      /\bhow (do|can|would) i (contact|reach|get in touch with|get a hold of|talk to)\b/i,
      /\b(contact|customer|support|help)\s+(details|info|information)\b/i,
      /\b(speak|talk) to (a |someone in |the )?(human|person|support|customer service|real)\b/i,
    ],
    answer: () =>
      `You can reach our team at ${CONTACT_EMAIL} 💕 We're around ${SUPPORT_HOURS} and usually reply within one business day — orders, products, subscriptions, anything at all.`,
  },
  {
    category: "order_status",
    patterns: [
      /\bwhere('?s| is| are)\b.{0,20}\b(my|the)\b.{0,20}\border\b/i,
      /\b(track|tracking)\b.{0,20}\b(my |an |the )?(order|package|shipment|parcel)\b/i,
      /\border status\b/i,
      /\b(status|update) (of|on)\b.{0,20}\bmy order\b/i,
      /\b(has|did|have)\b.{0,20}\bmy order\b.{0,20}\b(ship|shipped|sent|arrived|left)\b/i,
      /\bwhen (will|does|is)\b.{0,25}\b(my |the )?(order|package|delivery)\b.{0,25}\b(arrive|ship|get here|come|deliver)\b/i,
    ],
    answer: () =>
      `You can see live status and tracking for every order on your account page: ${ORDER_HISTORY_URL} ✨ If anything looks off there, email us at ${CONTACT_EMAIL} and we'll dig in with you.`,
  },
  {
    category: "business_address",
    patterns: [
      // Deliberately narrow: must be about OUR postal address, not the
      // customer's shipping address on an order.
      /\b(mailing|postal|physical|business|company|return|street) address\b/i,
      /\bwhere (are|is) (you|beauteas|your (company|business|office|warehouse))\b.{0,20}\b(located|based|from|ship(ped)? from)?\b/i,
      /\b(your|beauteas'?s?) (headquarters|hq|office|address)\b/i,
      /\bwhat('?s| is) your address\b/i,
    ],
    answer: () =>
      `Our mailing address is ${BUSINESS_ADDRESS_LINE}. For anything that needs a person, ${CONTACT_EMAIL} is the fastest way to reach us 💕`,
  },
];

/**
 * Classify a question against the deterministic category table.
 *
 * Pure and synchronous: no model call, no network, no database. Returns `null`
 * when nothing matches, which means "carry on with retrieval + generation".
 */
export function classifyQuery(question: string): DeterministicAnswer | null {
  if (typeof question !== "string") return null;
  const q = question.trim();
  if (!q) return null;

  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(q))) {
      return { category: rule.category, answer: rule.answer() };
    }
  }
  return null;
}

/** Category ids in match order — exported for tests and diagnostics. */
export const DETERMINISTIC_CATEGORIES: readonly DeterministicCategory[] = RULES.map(
  (r) => r.category
);
