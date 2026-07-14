/**
 * Shared email footer fragments — CAN-SPAM compliance (BMC-184).
 *
 * Every commercial/transactional email must display the sender's physical
 * postal address; commercial (marketing) email must additionally carry a
 * working unsubscribe mechanism. These helpers centralize the address string
 * and the unsubscribe markup so every template stays consistent.
 *
 * Pure string builders — no framework/runtime imports.
 */

/** Business physical mailing address (CAN-SPAM §5 requires a valid postal address). */
export const MAILING_ADDRESS = {
  business: 'BeauTeas',
  line1: '5504 S Lilly Creek Ct.',
  city: 'Byers',
  state: 'CO',
  zip: '80103',
  country: 'USA',
} as const;

/** One-line postal address, e.g. "BeauTeas · 5504 S Lilly Creek Ct., Byers, CO 80103, USA". */
export function mailingAddressLine(): string {
  const a = MAILING_ADDRESS;
  return `${a.business} · ${a.line1}, ${a.city}, ${a.state} ${a.zip}, ${a.country}`;
}

type FooterTheme = 'light' | 'dark';

/** Muted address/legal color tuned per template theme (light templates in
 *  email.ts, dark templates in review-notifications.ts). */
const MUTED_COLOR: Record<FooterTheme, string> = {
  light: '#94a3b8',
  dark: '#6b7280',
};

/** `<p>` carrying the physical postal address, styled for the given theme. */
export function postalAddressHtml(theme: FooterTheme = 'light'): string {
  return `<p style="color: ${MUTED_COLOR[theme]}; font-size: 12px; line-height: 16px; margin: 0 0 8px;">${mailingAddressLine()}</p>`;
}

/**
 * Unsubscribe footer line for commercial email. `url` must be a pre-fetch-safe
 * confirmation link — a GET renders a confirm page and only a POST performs the
 * opt-out (see app/api/email/unsubscribe/route.ts), so email-client/scanner
 * pre-fetching never silently unsubscribes anyone.
 */
export function unsubscribeHtml(url: string, theme: FooterTheme = 'dark'): string {
  const color = MUTED_COLOR[theme];
  return `<p style="color: ${color}; font-size: 12px; line-height: 18px; margin: 0 0 8px;">You're receiving this because you purchased from BeauTeas. <a href="${url}" style="color: ${color}; text-decoration: underline;">Unsubscribe from review reminders</a>.</p>`;
}
