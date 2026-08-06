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
 * A category belongs here when the question has ONE correct answer that some
 * system of record already owns — config (`canonical-facts.ts`) or an admin
 * setting in D1. Config-backed categories resolve synchronously; D1-backed ones
 * (`refund_window`, BMC-243; `shipping_rates`, BMC-242) resolve in the async
 * second step, so a MISS still performs no I/O.
 *
 * PRICES are deliberately excluded (BMC-242). "How much is the Evening blend?"
 * is entity resolution, not a lookup — a regex can spot the question shape but
 * cannot decide WHICH product, which is exactly what vector retrieval already
 * does well. That belongs in the system prompt's VERIFIED FACTS block, not here.
 */

import {
  BUSINESS_ADDRESS_LINE,
  CONTACT_EMAIL,
  ORDER_HISTORY_URL,
  REFUND_POLICY_URL,
  SHIPPING_POLICY_URL,
  SITE_URL,
  SUPPORT_HOURS,
} from "@/lib/ai/canonical-facts";
import { Money } from "@/lib/money";
import { getSaleRules } from "@/lib/sale/settings";
import { resolveShippingOptions } from "@/lib/services/shipping-options";
import type { ShippingOption } from "@/lib/types/shipping";
import { getRefundPolicy } from "@/lib/utils/settings";

/** Identifier for the matched category, surfaced for logging/tests. */
export type DeterministicCategory =
  | "contact_email"
  | "order_status"
  | "business_address"
  | "refund_window"
  | "minimum_order"
  | "store_closing"
  | "tea_freshness"
  | "shipping_rates";

interface CategoryRule {
  category: DeterministicCategory;
  /** Question matches the category if ANY pattern matches. */
  patterns: RegExp[];
  /**
   * Question is NOT this category if ANY of these match, even when a `patterns`
   * entry does. Used where a narrower topic shares the category's vocabulary.
   */
  exclude?: RegExp[];
  /**
   * Sync answer, built lazily so it always reflects the current canonical value.
   * Omitted for categories whose value comes from D1 — those are resolved in
   * `resolveDeterministicAnswer`.
   */
  answer?: () => string;
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
      /\b(what|whats|what's|which|where|who)\b.{0,30}\b(e-?mail)\b/i,
      // "Who do I email when..." — without this the trailing clause ("...my
      // order status is wrong") falls through to the order_status rule and
      // answers a different question than the one asked.
      /\b(who|where)\b.{0,20}\b(do|should|can|would) i\b.{0,10}\b(e-?mail|contact|reach|write)\b/i,
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
      // The location qualifier is REQUIRED. Left optional, the trailing `\b`
      // matched an empty string and swallowed ordinary small talk — "Where are
      // you today?" and "Where are you from?" both got the canned address.
      /\bwhere (are|is) (you|beauteas|your (company|business|office|warehouse))\b.{0,20}\b(located|based|headquartered|ship(ped)? from)\b/i,
      /\b(your|beauteas'?s?) (headquarters|hq|office|address)\b/i,
      /\bwhat('?s| is) your address\b/i,
    ],
    answer: () =>
      `Our mailing address is ${BUSINESS_ADDRESS_LINE}. For anything that needs a person, ${CONTACT_EMAIL} is the fastest way to reach us 💕`,
  },
  {
    category: "refund_window",
    // Answered from D1 (`refund.return_window_days`), so this rule has no sync
    // `answer` — see `resolveDeterministicAnswer`.
    patterns: [
      /\b(return|refund)s? (policy|window|period|timeframe)\b/i,
      /\bhow (long|many days)\b.{0,30}\b(return|refund|send (it )?back)\b/i,
      /\bcan i (still )?(return|send back|get a refund)\b/i,
      /\b(window|deadline) (to|for) (a )?(return|refund)\b/i,
      /\bwhat('?s| is) your (return|refund) policy\b/i,
      /\bdo you (accept|take|do) returns\b/i,
    ],
  },
  {
    category: "minimum_order",
    // Answered from `sale.minimum_boxes` in D1, so no sync `answer`.
    patterns: [
      // "number" was deliberately dropped from this list — "minimum number"
      // is generic enough to also match "minimum number of reviews" or "of
      // characters", neither of which is an order-size question. "quantity"
      // stays: nobody asks about a minimum review quantity.
      /\bminimum (order|purchase|quantity|boxes|spend|cart)\b/i,
      /\b(order|buy|purchase) minimum\b/i,
      /\bhow many (boxes|tins|do i have to|must i)\b.{0,25}\b(buy|order|purchase)\b/i,
      /\bdo i have to buy\b.{0,20}\b(minimum|at least)\b/i,
      // The subject word must sit IMMEDIATELY after "a minimum" (whitespace
      // only, no `.{0,N}` gap). A gap let "is there a minimum AGE TO BUY
      // tea?" match on the trailing "buy" — a legal-age question, not an
      // order-size one. Zero gap means only the actual subject of "minimum"
      // qualifies, which also makes this redundant with the pattern above
      // for "minimum order" — kept for the nouns that pattern doesn't cover
      // ("spend", "cart", a bare "buy").
      /\bis there a minimum\b\s+(order|purchase|buy|boxes|spend|cart)\b/i,
    ],
    exclude: [
      // Past-tense self-reference ("how many boxes DID I order/buy") is a
      // question about THIS shopper's order history, not the box minimum —
      // `order_status` doesn't have a quantity-shaped pattern of its own, so
      // without this the "how many boxes...buy/order" pattern above swallows
      // it. Falls through to retrieval instead.
      /\b(did|have|has) i (order|buy|bought|purchase|purchased)\b/i,
      /\bi (ordered|bought|purchased)\b/i,
    ],
  },
  {
    category: "store_closing",
    patterns: [
      /\b(going out of business|shutting down|shutting up shop|closing down|winding down)\b/i,
      /\bwhy (are|is)\b.{0,20}\b(you|beauteas)\b.{0,15}\bclos(ing|e)\b/i,
      /\b(are|is)\b.{0,15}\b(you|beauteas)\b.{0,15}\bclos(ing|ed)\b/i,
      /\b(last|final) chance\b.{0,20}\b(buy|order)\b/i,
    ],
    exclude: [
      // Store-HOURS phrasing ("closed today", "closed on Sundays", "closing
      // early") shares the closing/closed vocabulary with permanent closure
      // but asks a different question — the same "topic mismatch dressed as
      // a fact" shape as "plastic-free shipping" matching the rate card. A
      // relative day, a weekday name, "for the holiday/weekend", or
      // "early/late" all signal HOURS, not going-out-of-business.
      /\bclos(ing|ed)\b.{0,20}\b(today|tonight|tomorrow|this (morning|afternoon|evening|weekend)|early|late|right now)\b/i,
      /\bclos(ing|ed)\b.{0,20}\b(on\s+)?(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?|holidays?)\b/i,
      /\bclos(ing|ed)\b.{0,20}\bfor the (holiday|weekend|day|night)\b/i,
      // Temporary operational closures ("closed for maintenance") are also
      // not the going-out-of-business question.
      /\bclos(ing|ed)\b.{0,20}\bfor (maintenance|repairs?|cleaning|restocking|inventory)\b/i,
    ],
    answer: () =>
      `We are, yes 💕 After a lot of thought we're closing BeauTeas for good, and everything left is going out at clearance prices. The whole story — and a very big thank-you — is here: ${SITE_URL}/thank-you`,
  },
  {
    category: "tea_freshness",
    // DELIBERATELY NARROW. The subject must be age, freshness, or expiry — an
    // earlier draft matching a bare /\bfresh\b/ swallowed "is this freshly
    // blended?" and "what's the freshest thing you have?", which retrieval and
    // the catalog answer far better than a canned line about storage.
    patterns: [
      /\bhow (old|fresh)\b.{0,20}\b(is|are)\b.{0,20}\b(the |this |your )?(tea|teas|blend|blends|stock)\b/i,
      /\b(tea|teas|blend|blends|stock)\b.{0,20}\b(expired?|expiry|expiration|out of date|past its date)\b/i,
      /\b(is|are)\b.{0,20}\b(the |this |your )?(tea|teas|blend|blends)\b.{0,20}\bstill (good|fresh|drinkable|ok|okay)\b/i,
      /\bshelf life\b/i,
      /\bwhen does\b.{0,25}\bexpire\b/i,
    ],
    answer: () =>
      `Honest answer: our remaining stock has been in sealed, airtight storage for several years 💕 It's been kept carefully and it's still lovely to drink — the aroma is a little gentler than a fresh harvest, which is part of why everything is priced the way it is. More on that here: ${SITE_URL}/thank-you`,
  },
  {
    category: "shipping_rates",
    // Answered from the storefront shipping model in D1 (`shipping.methods` +
    // `store.free_shipping_threshold`), so no sync `answer` — see
    // `resolveDeterministicAnswer`.
    //
    // Last in the table on purpose: `order_status` owns "when will MY order
    // arrive" (a question about one shipment, not the rate card), and this rule
    // must not reach it.
    patterns: [
      /\bhow much\b.{0,30}\b(shipping|delivery|postage)\b/i,
      /\b(shipping|delivery|postage)\b.{0,20}\b(cost|costs|rate|rates|price|prices|fee|fees|charge|charges)\b/i,
      /\b(cost|price|rate|fee) (of|for) (shipping|delivery|postage)\b/i,
      // The lookbehind matters: a bare `\bfree shipping\b` also matches INSIDE
      // "plastic-free shipping" / "carbon-free shipping", handing a packaging or
      // sustainability question the rate card. `[-\s]` still admits the
      // hyphenated "free-shipping" spelling, which the lookbehind keeps distinct
      // from the "<something>-free shipping" case.
      /(?<![\w-])free[-\s]shipping\b/i,
      /\bhow (long|many days)\b.{0,30}\b(shipping|delivery|to (ship|deliver|arrive|get here))\b/i,
      /\bhow (fast|quick(ly)?|soon)\b.{0,25}\b(ship|shipped|deliver|delivered|arrive|get here)\b/i,
      /\b(shipping|delivery) (time|times|speed|estimate|estimates|option|options|method|methods)\b/i,
      /\bwhat (are|r) your shipping\b/i,
      /\bdo you (offer|have|do)\b.{0,20}\b(express|overnight|expedited|rush|next[- ]day|2[- ]day|two[- ]day)\b/i,
    ],
    exclude: [
      // Return/exchange postage is a different policy with a different answer,
      // and the rate card above is the OUTBOUND one. Let retrieval take it.
      /\b(return|exchange)s?\b.{0,20}\bship/i,
      /\bship(ping)?\b.{0,20}\b(it |them )?back\b/i,
      // The customer's own address on an order — not a question about rates.
      /\bshipping address\b/i,
      // Destination COVERAGE ("do you ship to Canada?") is not in the rate card.
      // Deliberately narrow: an earlier `\bship(s|ping)? to\b` also swallowed
      // "how much is shipping to Colorado?" and "how much is shipping to my
      // address?", which the flat US rate card answers perfectly well.
      // The subject is required: without it, "how much does it cost to ship to
      // Denver?" reads as a coverage question because of "does ... ship to".
      /\b(do|does|can|could|will|would)\s+(you|they|beauteas)\b.{0,15}\bship (to|outside|overseas|abroad)\b/i,
      // Anything explicitly non-domestic — the rate card is US-only.
      /\b(international(ly)?|overseas|abroad|customs|duties|tariffs?|outside the (us|usa|united states))\b/i,
    ],
  },
];

/**
 * Classify a question against the deterministic category table.
 *
 * Pure and synchronous: no model call, no network, no database — a MISS costs
 * only a handful of regex tests and performs no I/O, which is what makes it safe
 * to run ahead of every chat request. Returns `null` when nothing matches,
 * meaning "carry on with retrieval + generation".
 *
 * Resolution is deliberately a separate step (`resolveDeterministicAnswer`):
 * some categories read D1, and folding that in here would make every request
 * await something even when nothing matched.
 */
export function classifyQuery(question: string): DeterministicCategory | null {
  if (typeof question !== "string") return null;
  const q = question.trim();
  if (!q) return null;

  for (const rule of RULES) {
    if (rule.exclude?.some((pattern) => pattern.test(q))) continue;
    if (rule.patterns.some((pattern) => pattern.test(q))) return rule.category;
  }
  return null;
}

/**
 * Produce the answer for a matched category.
 *
 * Async because some categories read their value from D1. Only ever called on a
 * hit, so the database is never touched for an ordinary product question.
 */
export async function resolveDeterministicAnswer(
  category: DeterministicCategory
): Promise<string> {
  const rule = RULES.find((r) => r.category === category);
  if (rule?.answer) return rule.answer();

  if (category === "refund_window") return refundWindowAnswer();
  if (category === "minimum_order") return minimumOrderAnswer();
  if (category === "shipping_rates") return shippingRatesAnswer();

  // Unreachable while every category has either a sync answer or a branch
  // above; falling back to the contact address beats returning nothing.
  return `Email us at ${CONTACT_EMAIL} and we'll help you out 💕`;
}

/**
 * Return-window answer, read from `refund.return_window_days` (BMC-243) — unless
 * the store is in final-sale mode (`sale.final_sale`, GOOB), in which case there
 * is no return window to state at all.
 *
 * On a settings-read failure this answers WITHOUT a number rather than guessing
 * one. Stating a wrong return window is the same class of failure as the invented
 * support address that started this work — and unlike a bad address, the response
 * guard cannot catch a bad number.
 */
async function refundWindowAnswer(): Promise<string> {
  try {
    const { finalSale } = await getSaleRules();
    if (finalSale) {
      // Driven by the same setting the policy page reflects, so Chai and the
      // site cannot drift. Stating a return window that no longer exists is the
      // same class of failure as inventing one.
      return `We're closing up shop, so every order is final sale — no returns or exchanges on the teas 💕 That said, if your order arrives damaged or never turns up, we'll absolutely make it right. Just email ${CONTACT_EMAIL} and we'll sort it out. Full details: ${REFUND_POLICY_URL}`;
    }

    const { returnWindowDays } = await getRefundPolicy();
    return `You've got ${returnWindowDays} days from delivery to start a return 💕 Full details live on our refund policy page (${REFUND_POLICY_URL}) — and if you'd rather just ask a person, ${CONTACT_EMAIL} is the fastest way.`;
  } catch (error) {
    console.error("[chai] refund policy lookup failed:", error);
    return `Our full return policy is here: ${REFUND_POLICY_URL} — and if you'd rather ask a person, email ${CONTACT_EMAIL} 💕`;
  }
}

/** Minimum-order answer, read from `sale.minimum_boxes` so it cannot drift. */
async function minimumOrderAnswer(): Promise<string> {
  try {
    const { minimumBoxes } = await getSaleRules();
    return `There's a ${minimumBoxes} boxes minimum on orders right now 💕 Mix and match however you like across the Morning, Afternoon and Evening blends — it all counts toward the same total. It keeps shipping affordable while we clear the last of our stock.`;
  } catch (error) {
    console.error("[chai] minimum order lookup failed:", error);
    return `There's a minimum order while we clear the last of our stock — your cart will tell you exactly how many more boxes you need 💕`;
  }
}

/**
 * Shipping rates + delivery estimates, read from the storefront shipping model
 * (`lib/services/shipping-options.ts`) — the SAME seam `/api/shipping-options`
 * quotes and the charge floor enforces (BMC-242).
 *
 * Two things this answer is careful about:
 *
 * 1. **It never says the shopper qualifies for free shipping.** A chat message
 *    carries no cart, so the subtotal passed here is `0` and the quoted costs are
 *    the UNDISCOUNTED base rates. The threshold is stated as a policy ("orders of
 *    $X or more"), never as a fact about this person. Telling someone their order
 *    ships free when it doesn't is a new way to be confidently wrong, which is the
 *    whole reason this module exists.
 * 2. **On a settings-read failure it states no numbers.** The response guard
 *    rewrites invented emails and URLs but has nothing to say about an invented
 *    price — so a degraded read points at the policy page instead of guessing.
 */
async function shippingRatesAnswer(): Promise<string> {
  try {
    const { options, freeShippingThresholdMajor, freeMethodIds } =
      await resolveShippingOptions(0);
    if (options.length === 0) throw new Error("no enabled shipping methods configured");

    const rates = options.map((option) => `• ${describeShippingOption(option)}`).join("\n");
    const freeShipping = freeShippingSentence(options, freeShippingThresholdMajor, freeMethodIds);

    return `Here's how we ship within the US 💕\n\n${rates}\n\n${freeShipping}I can't see your cart from here, so those are the standard US rates — checkout shows the exact cost for your order before you pay. For anywhere outside the US, email ${CONTACT_EMAIL}. Full details: ${SHIPPING_POLICY_URL}`;
  } catch (error) {
    console.error("[chai] shipping rate lookup failed:", error);
    return `Our current shipping rates and delivery estimates are here: ${SHIPPING_POLICY_URL} — and checkout shows the exact cost for your order before you pay. If you'd rather ask a person, email ${CONTACT_EMAIL} 💕`;
  }
}

/**
 * One rate line: `Standard (5–7 days) — $5.99`. `cost` is MAJOR units.
 *
 * THROWS on a cost that isn't a usable number. `shipping.methods` is admin-edited
 * JSON, so a method can arrive with a missing or non-numeric `cost`; rendering
 * that as "free" would advertise a rate we don't charge. Failing here routes the
 * whole answer to the no-numbers fallback instead.
 */
function describeShippingOption(option: ShippingOption): string {
  const cost = rateMajor(option.cost);
  if (!Number.isFinite(cost) || cost < 0) {
    throw new Error(`shipping method ${option.id} has an unusable cost: ${option.cost}`);
  }
  const price = cost > 0 ? Money.fromMajor(cost).format() : "free";
  // The stock labels already carry their timing ("Standard (5–7 days)"); only
  // append an estimate when an admin-configured label doesn't state one.
  const days =
    !/\d/.test(option.label) && Number.isFinite(option.estimatedDays) && option.estimatedDays > 0
      ? ` (about ${option.estimatedDays} business ${option.estimatedDays === 1 ? "day" : "days"})`
      : "";
  return `${option.label} — ${price}${days}`;
}

/**
 * Coerce an admin-configured cost to a rate in MAJOR units, or NaN if it isn't
 * one. Deliberately NOT `Number(raw)`: `Number(null)`, `Number('')`,
 * `Number('  ')`, `Number([])` and `Number(false)` are all `0`, so a method
 * whose cost field was cleared in the admin UI would render as "free" —
 * advertising a rate we don't charge. Only a real number or a non-blank numeric
 * string counts; everything else fails the caller's check and degrades the whole
 * answer to the no-numbers fallback. (A genuine `0` still means free.)
 */
function rateMajor(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") return Number(raw);
  return NaN;
}

/**
 * The free-shipping policy as a THRESHOLD, never as a claim about this shopper.
 *
 * Returns "" — say nothing — in every case where the perk can't be stated
 * accurately: no eligible method is enabled, or the configured threshold isn't a
 * usable positive number. A threshold at or below zero already shows up as a
 * `free` rate line above, so silence there is terse but never wrong; the failure
 * mode worth avoiding is announcing free shipping off an unreadable setting.
 */
function freeShippingSentence(
  options: ShippingOption[],
  thresholdMajor: number,
  freeMethodIds: string[]
): string {
  if (!freeMethodIds || freeMethodIds.length === 0) return "";

  const eligible = options.filter((option) => freeMethodIds.includes(option.id));
  if (eligible.length === 0) return "";
  if (!Number.isFinite(thresholdMajor) || thresholdMajor <= 0) return "";

  const names = formatList(eligible.map((option) => option.label));
  return `Orders with a subtotal of ${Money.fromMajor(thresholdMajor).format()} or more ship free via ${names}. `;
}

/** `a`, `a and b`, `a, b and c`. */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Category ids in match order — exported for tests and diagnostics. */
export const DETERMINISTIC_CATEGORIES: readonly DeterministicCategory[] = RULES.map(
  (r) => r.category
);
