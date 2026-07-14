/**
 * === Email unsubscribe (CAN-SPAM, BMC-184) ===
 *
 * Public endpoint that opts an address out of review-reminder (marketing)
 * email. The link in the email carries an HMAC-signed token (see
 * lib/email/unsubscribe-token.ts) that names the target address, so no login
 * or DB lookup is needed and nobody can unsubscribe an address they don't hold.
 *
 * Pre-fetch safety: a GET only RENDERS a confirmation page and never mutates —
 * email clients, Gmail's image/link proxy, and security scanners (Outlook
 * SafeLinks, etc.) routinely GET every link, so a GET that opted people out
 * would silently unsubscribe them. The opt-out happens only on POST: the
 * confirm button, and RFC 8058 one-click (`List-Unsubscribe-Post:
 * List-Unsubscribe=One-Click`, which providers always send as a POST).
 */

import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token';
import { recordUnsubscribe } from '@/lib/models/email-preferences';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/** Minimal escaping for the one attacker-influenced value we echo into markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${title} · BeauTeas</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fdf8f6; color: #222; margin: 0; padding: 48px 16px; }
    .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 10px 30px rgba(0,0,0,0.06); text-align: center; }
    h1 { font-size: 20px; margin: 0 0 12px; color: #99544a; }
    p { color: #555; line-height: 22px; margin: 0 0 16px; }
    button { border: 0; cursor: pointer; background: linear-gradient(135deg, #cf8577, #b86a5d); color: #fff; font-weight: 600; font-size: 15px; padding: 12px 24px; border-radius: 9999px; }
    a { color: #b86a5d; }
  </style>
</head>
<body><div class="card">${inner}</div></body>
</html>`;
}

/** Pull the token from the query string first (one-click URL + our POST action)
 *  and fall back to a posted form field. */
async function extractToken(req: Request): Promise<string | null> {
  const fromQuery = new URL(req.url).searchParams.get('token');
  if (fromQuery) return fromQuery;
  if (req.method === 'POST') {
    try {
      const form = await req.formData();
      const value = form.get('token');
      if (typeof value === 'string' && value) return value;
    } catch {
      // Non-form body (e.g. a bare one-click POST) — token must be in the query.
    }
  }
  return null;
}

// GET renders the confirmation page — never mutates (pre-fetch safe).
export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token');
  const email = token ? await verifyUnsubscribeToken(token) : null;

  if (!email || !token) {
    return htmlResponse(
      shell(
        'Link expired',
        `<h1>This unsubscribe link isn't valid</h1>
         <p>It may have expired or been altered. If you'd still like to stop review reminders, reply to any BeauTeas email and we'll take care of it.</p>`,
      ),
      400,
    );
  }

  const safeToken = escapeHtml(token);
  return htmlResponse(
    shell(
      'Confirm unsubscribe',
      `<h1>Unsubscribe from review reminders?</h1>
       <p>We'll stop sending review-reminder emails to <strong>${escapeHtml(email)}</strong>. You'll still get transactional emails about your orders and subscriptions.</p>
       <form method="POST" action="/api/email/unsubscribe?token=${encodeURIComponent(token)}">
         <input type="hidden" name="token" value="${safeToken}" />
         <button type="submit">Confirm unsubscribe</button>
       </form>`,
    ),
  );
}

// POST performs the opt-out: our confirm button and RFC 8058 one-click.
export async function POST(req: Request): Promise<Response> {
  // Public, mutating endpoint — guard the D1 write like other public routes.
  // Fails open when the binding is absent (plain `next dev`, unit tests).
  const limited = await enforceRateLimit('PUBLIC_RATE_LIMITER', `unsub:${getClientIp(req)}`);
  if (limited) return limited;

  const token = await extractToken(req);
  const email = token ? await verifyUnsubscribeToken(token) : null;

  if (!email) {
    return htmlResponse(
      shell(
        'Link expired',
        `<h1>This unsubscribe link isn't valid</h1>
         <p>It may have expired or been altered. Reply to any BeauTeas email and we'll unsubscribe you.</p>`,
      ),
      400,
    );
  }

  await recordUnsubscribe(email, 'review_reminders');

  return htmlResponse(
    shell(
      'Unsubscribed',
      `<h1>You're unsubscribed</h1>
       <p><strong>${escapeHtml(email)}</strong> will no longer receive review-reminder emails. Order and subscription emails are unaffected.</p>
       <p><a href="https://beauteas.com">Return to BeauTeas</a></p>`,
    ),
  );
}
