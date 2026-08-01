/**
 * === Canonical Facts (BMC-215) ===
 *
 * The small set of factual values the Chai assistant is allowed to state about
 * BeauTeas, re-exported from the modules that already own them.
 *
 * This file deliberately DEFINES NOTHING. Every value below is imported from its
 * existing source of truth:
 *
 * | Fact             | Owner                                   |
 * | ---------------- | --------------------------------------- |
 * | Contact email    | `lib/brand.config.ts` (`brand.contact`) |
 * | Support hours    | `lib/brand.config.ts` (`brand.contact`) |
 * | Business address | `lib/utils/email-footer.ts`             |
 * | Site URL         | `lib/seo/metadata.ts` (`BASE_URL`)      |
 *
 * WHY: on 2026-07-27 Chai told a customer to email `support@beauteteas.com` — a
 * nonexistent mailbox at a misspelled domain — because retrieval missed
 * `knowledge_md/support.md` and the model filled the gap by inventing something
 * plausible. The fix has two halves (`deterministic-answers.ts` answers the known
 * question shapes without a model, `response-guard.ts` scrubs invented contact
 * details out of everything else) and both halves must agree on the facts. A
 * second hardcoded copy of the address is how `hello@` drifted from `info@` in
 * the first place, so there isn't one.
 */

import { brand } from "@/lib/brand.config";
import { BASE_URL } from "@/lib/seo/metadata";
import { MAILING_ADDRESS, mailingAddressLine } from "@/lib/utils/email-footer";

/** The one address customers should ever be given. */
export const CONTACT_EMAIL: string = brand.contact.email;

/** Support availability, mirrored in `knowledge_md/support.md`. */
export const SUPPORT_HOURS: string = brand.contact.supportHours;

/** One-line business postal address (CAN-SPAM footer address). */
export const BUSINESS_ADDRESS_LINE: string = mailingAddressLine();

/** Canonical site origin for this environment (staging emits its own host). */
export const SITE_URL: string = BASE_URL;

/** Where a signed-in customer tracks an order. */
export const ORDER_HISTORY_URL = `${BASE_URL}/account/orders`;

/** Published refund/return policy page (CMS, seeded by migration 0014). */
export const REFUND_POLICY_URL = `${BASE_URL}/refund-policy`;

/** Published shipping policy page (CMS, seeded by migration 0014). */
export const SHIPPING_POLICY_URL = `${BASE_URL}/shipping-policy`;

export { MAILING_ADDRESS };

/**
 * Hostnames Chai may link to. Anything else in a generated answer is treated as
 * invented and rewritten (see `response-guard.ts`).
 *
 * Derived from `BASE_URL` rather than listed literally, so a staging deploy
 * pointed at `shop.beauteas.com` allowlists its own host instead of silently
 * rewriting every correct link it produces.
 */
export const ALLOWED_HOSTS: readonly string[] = Array.from(
  new Set(
    [
      // The apex plus the subdomains that actually serve customer-facing content.
      "beauteas.com",
      "www.beauteas.com",
      "shop.beauteas.com",
      "img.beauteas.com",
      hostOf(BASE_URL),
    ].filter((h): h is string => Boolean(h))
  )
);

/** Extract a lowercase hostname from an absolute URL, or null if unparseable. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
