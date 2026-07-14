/**
 * Data access for the CAN-SPAM unsubscribe suppression list (BMC-184).
 * See lib/db/schema/email-preferences.ts.
 */
import { and, inArray } from 'drizzle-orm';
import { getDbAsync } from '@/lib/db';
import { email_unsubscribes } from '@/lib/db/schema/email-preferences';
import { normalizeEmail } from '@/lib/email/unsubscribe-token';

type Db = Awaited<ReturnType<typeof getDbAsync>>;

/** An opt-out at either of these scopes suppresses review-reminder email. */
const REVIEW_REMINDER_SCOPES = ['all', 'review_reminders'];

/**
 * Batch variant: given many candidate emails, return the normalized set that
 * has opted out of review reminders — in ONE query. Used by the reminder send
 * loop so it doesn't do an N+1 lookup per candidate. Pass the caller's `db` to
 * reuse its Cloudflare context instead of re-acquiring one.
 */
export async function getReviewReminderOptOuts(
  emails: string[],
  db?: Db,
): Promise<Set<string>> {
  const normalized = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (!normalized.length) return new Set();

  const conn = db ?? (await getDbAsync());
  const rows = await conn
    .select({ email: email_unsubscribes.email })
    .from(email_unsubscribes)
    .where(
      and(
        inArray(email_unsubscribes.email, normalized),
        inArray(email_unsubscribes.scope, REVIEW_REMINDER_SCOPES),
      ),
    );
  return new Set(rows.map((r) => r.email));
}

/** Record an opt-out for `email` at `scope` (idempotent). */
export async function recordUnsubscribe(email: string, scope = 'review_reminders'): Promise<void> {
  const db = await getDbAsync();
  await db
    .insert(email_unsubscribes)
    .values({ email: normalizeEmail(email), scope })
    .onConflictDoNothing();
}
