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
 * an explicit `http(s)://` or a `www.` prefix is matched regardless of TLD — this
 * list only exists to stop ordinary prose from looking like a hostname.
 *
 * It deliberately covers far more than the handful a hallucination is *likely*
 * to reach for. An earlier 10-entry list (com/net/org/io/co/shop/store/ai/app/us)
 * meant a bare `evil-phishing.xyz` passed through completely unscrubbed, which
 * broke the guard's whole guarantee for most of the real TLD space.
 *
 * Kept as a list rather than "any 2+ letters" because an unbounded TLD turns
 * ordinary copy into false positives — see `isLikelyBareDomain`.
 */
const BARE_DOMAIN_TLDS = [
  // Legacy gTLDs + the common ccTLDs a model actually produces.
  "com", "net", "org", "edu", "gov", "int", "mil", "info", "biz", "name",
  "io", "co", "ai", "app", "dev", "us", "uk", "ca", "au", "de", "fr", "es",
  "it", "nl", "se", "no", "jp", "cn", "in", "br", "mx", "eu", "me", "tv",
  "cc", "ly", "sh", "gg", "to", "fm", "am", "at", "be", "ch", "cz", "dk",
  "fi", "gr", "hk", "ie", "il", "kr", "nz", "pl", "pt", "ro", "ru", "sg",
  "za",
  // New gTLDs plausible for a retail/beauty hallucination.
  "shop", "store", "online", "site", "website", "web", "xyz", "top", "club",
  "life", "live", "world", "today", "email", "help", "support", "care",
  "health", "beauty", "spa", "tea", "organic", "green", "eco", "natural",
  "shopping", "market", "buy", "sale", "deals", "gift", "gifts", "brand",
  "company", "global", "group", "team", "agency", "services", "solutions",
  "digital", "media", "news", "blog", "page", "link", "click", "one", "now",
].join("|");

/**
 * Single combined matcher with named groups. Alternation order is load-bearing:
 *   1. email (optionally `mailto:`-prefixed)
 *   2. explicit URL (`https://…` or `www.…`)
 *   3. bare domain with a known TLD
 *
 * The groups matter as much as the order: classifying a match by WHICH branch
 * matched (rather than by `token.includes("@")`) is what keeps
 * `evil.net/track?ref=real@address.com` from being mistaken for an email address
 * and silently accepted on the strength of the address in its query string.
 */
const CONTACT_PATTERN = new RegExp(
  [
    // 1. email
    "(?<email>(?:mailto:)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,})",
    // 2. explicit URL
    "(?<url>(?:https?://|www\\.)[^\\s<>()\\[\\]\"'`]+)",
    // 3. bare domain + optional path
    `(?<bare>(?:[A-Z0-9-]+\\.)+(?:${BARE_DOMAIN_TLDS})\\b(?:/[^\\s<>()\\[\\]"'\`]*)?)`,
  ].join("|"),
  "gi"
);

/**
 * Anything in a URL's path/query/fragment that means a SECOND destination is
 * riding along inside a token whose leading host we already allowlisted —
 * `https://beauteas.com/redirect?to=https://evil.com/login` and the
 * `user@host`-in-query shape. Matching the leading host is not enough.
 */
const EMBEDDED_DESTINATION = /https?:\/\/|@|%3a%2f%2f|%40/i;

/**
 * Distinguish a scheme-less hostname from two run-together prose sentences.
 *
 * Prose joins sentences far more often than it contains a bare hostname, and
 * `min.Now` is indistinguishable from a hostname by shape alone — several TLDs
 * ("now", "store", "care", "life", "today") are ordinary English words, so the
 * TLD list alone can't separate them.
 *
 * The tell is SENTENCE CASE: a capitalised-then-lowercase final label is how
 * prose starts a new sentence ("…5 min.Now sip"), and is not how anyone writes
 * a TLD. Testing for "not lowercase" instead was too blunt — it also skipped
 * `BEAUTEAS.COM.EVIL.COM`, letting an all-caps lookalike through.
 *
 * Residual, accepted: a sentence-cased TLD (`Beauteteas.Com`) is still read as
 * prose. Chat answers render as escaped plain text rather than auto-linkified
 * markup, so a string that slips through is inert rather than clickable.
 */
function isLikelyBareDomain(token: string): boolean {
  const host = token.split(/[/?#]/)[0];
  const tld = host.slice(host.lastIndexOf(".") + 1);
  return !/^[A-Z][a-z]+$/.test(tld);
}

/** Trailing sentence punctuation that a greedy URL match would swallow. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/** Extract a lowercase hostname from a matched URL/domain token. */
function hostFromToken(token: string): string {
  const withoutScheme = token.replace(/^https?:\/\//i, "");
  // ORDER MATTERS: isolate the authority BEFORE handling userinfo. Stripping at
  // the last "@" first treats an "@" anywhere in the query string as userinfo,
  // so `evil.net/track?ref=real@allowed.com` resolves to the ALLOWED host and
  // the whole token is waved through on the strength of someone else's domain.
  let authority = withoutScheme.split(/[/?#]/)[0];
  const at = authority.lastIndexOf("@");
  if (at !== -1) authority = authority.slice(at + 1);
  return authority.split(":")[0].toLowerCase();
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

  const scrubbed = text.replace(CONTACT_PATTERN, (rawMatch, ...args) => {
    // Named groups arrive as the last argument; they tell us WHICH branch
    // matched, which is what makes the classification trustworthy.
    const groups = args[args.length - 1] as
      | { email?: string; url?: string; bare?: string }
      | undefined;

    // Give back trailing punctuation the greedy match absorbed ("…evil.com.").
    const trailing = rawMatch.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const token = trailing ? rawMatch.slice(0, -trailing.length) : rawMatch;
    if (!token) return rawMatch;

    if (groups?.email !== undefined) {
      const mailto = /^mailto:/i.test(token);
      const address = mailto ? token.slice("mailto:".length) : token;
      if (isAllowedEmail(address)) return rawMatch;
      replaced.push(token);
      return `${mailto ? "mailto:" : ""}${CONTACT_EMAIL}${trailing}`;
    }

    // A scheme-less token that doesn't look like a hostname is ordinary prose.
    if (groups?.bare !== undefined && !isLikelyBareDomain(token)) return rawMatch;

    const host = hostFromToken(token);
    const remainder = token.slice(token.indexOf(host) + host.length);
    // Allowlisted host is necessary but NOT sufficient: a second destination
    // hidden in the path/query rides through on the first host's reputation.
    if (isAllowedHost(host) && !EMBEDDED_DESTINATION.test(remainder)) return rawMatch;

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
