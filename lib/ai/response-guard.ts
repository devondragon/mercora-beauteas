/**
 * === Chai Response Guard (BMC-215) ===
 *
 * Last line of defence before an assistant reply reaches a customer: no email
 * address or URL that BeauTeas doesn't own may appear in a Chai response.
 *
 * `deterministic-answers.ts` fixes the question shapes we anticipated. This
 * fixes the class — including the phrasings nobody thought to enumerate — by
 * checking the OUTPUT rather than the input. A model that invents
 * `support@beauteteas.com` mid-sentence gets it rewritten to the real address,
 * so the customer still ends up with a working way to reach us instead of a
 * mangled sentence or a dead mailbox.
 *
 * === Design notes ===
 * - **One pass, alternation-ordered.** Emails are matched before bare domains in
 *   a single combined regex, so the domain inside an address is consumed as part
 *   of that address and never re-examined as a URL. Two sequential `replace`
 *   passes would rewrite `support@evil.com` to `info@beauteas.com` and then
 *   re-inspect the substituted text.
 * - **Bare domains need a known TLD.** Matching `word.word` unanchored turns
 *   ordinary prose ("steep 5 min.Then sip") into a false positive that replaces
 *   real copy with a site link. Requiring a TLD from a short list keeps
 *   `beauteteas.com` caught and `min.Then` untouched.
 * - **Not applied to admin content generation.** The CMS HTML writer is a
 *   separate, admin-gated prompt whose whole job is authoring page copy that may
 *   legitimately link off-site. Scrubbing it would corrupt admin output.
 */

import { ALLOWED_HOSTS, CONTACT_EMAIL, SITE_URL } from "@/lib/ai/canonical-facts";

/**
 * TLDs recognised for SCHEME-LESS domains (e.g. "beauteteas.com"). Anything with
 * an explicit `http(s)://` or a `www.` prefix is matched regardless of TLD — the
 * list only exists to stop ordinary prose from looking like a hostname.
 */
const BARE_DOMAIN_TLDS = [
  "com",
  "net",
  "org",
  "io",
  "co",
  "shop",
  "store",
  "ai",
  "app",
  "us",
].join("|");

/**
 * Single combined matcher. Alternation order is load-bearing:
 *   1. email (optionally `mailto:`-prefixed)
 *   2. explicit URL (`https://…` or `www.…`)
 *   3. bare domain with a known TLD
 */
const CONTACT_PATTERN = new RegExp(
  [
    // 1. email
    "(?:mailto:)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}",
    // 2. explicit URL
    "(?:https?://|www\\.)[^\\s<>()\\[\\]\"'`]+",
    // 3. bare domain + optional path
    `(?:[A-Z0-9-]+\\.)+(?:${BARE_DOMAIN_TLDS})\\b(?:/[^\\s<>()\\[\\]"'\`]*)?`,
  ].join("|"),
  "gi"
);

/** Trailing sentence punctuation that a greedy URL match would swallow. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/** Extract a lowercase hostname from a matched URL/domain token. */
function hostFromToken(token: string): string {
  let host = token.replace(/^https?:\/\//i, "");
  // Drop userinfo, then path/query/fragment, then port.
  const at = host.lastIndexOf("@");
  if (at !== -1) host = host.slice(at + 1);
  host = host.split(/[/?#]/)[0];
  host = host.split(":")[0];
  return host.toLowerCase();
}

/** True when `host` is BeauTeas-owned (exact match against the allowlist). */
export function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.includes(host.toLowerCase());
}

/** True when `address` is the canonical contact mailbox. */
export function isAllowedEmail(address: string): boolean {
  return address.toLowerCase() === CONTACT_EMAIL.toLowerCase();
}

export interface ScrubResult {
  text: string;
  /** Tokens that were rewritten — logged so silent failure stays visible. */
  replaced: string[];
}

/**
 * Rewrite every email address and URL that BeauTeas doesn't own.
 *
 * - Unknown email → the canonical contact address (keeping any `mailto:` prefix,
 *   so markdown links stay well-formed).
 * - Unknown URL/domain → the canonical site URL.
 * - Allowlisted values are returned byte-for-byte unchanged.
 */
export function scrubContacts(text: string): ScrubResult {
  if (typeof text !== "string" || !text) return { text: text ?? "", replaced: [] };

  const replaced: string[] = [];

  const scrubbed = text.replace(CONTACT_PATTERN, (rawMatch) => {
    // Give back trailing punctuation the greedy match absorbed ("…evil.com.").
    const trailing = rawMatch.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const token = trailing ? rawMatch.slice(0, -trailing.length) : rawMatch;
    if (!token) return rawMatch;

    const mailto = /^mailto:/i.test(token);
    const bare = mailto ? token.slice("mailto:".length) : token;

    if (bare.includes("@")) {
      if (isAllowedEmail(bare)) return rawMatch;
      replaced.push(token);
      return `${mailto ? "mailto:" : ""}${CONTACT_EMAIL}${trailing}`;
    }

    if (isAllowedHost(hostFromToken(token))) return rawMatch;
    replaced.push(token);
    return `${SITE_URL}${trailing}`;
  });

  return { text: scrubbed, replaced };
}

/**
 * Convenience wrapper for the response path: scrubs and reports.
 *
 * A replacement means the model invented a contact detail, which is exactly the
 * silent failure BMC-215 exists to stop being silent — so it is logged rather
 * than swallowed.
 */
export function guardAssistantReply(reply: string): string {
  const { text, replaced } = scrubContacts(reply);
  if (replaced.length > 0) {
    console.warn(
      `[chai-guard] rewrote ${replaced.length} non-allowlisted contact reference(s):`,
      replaced.join(", ")
    );
  }
  return text;
}
