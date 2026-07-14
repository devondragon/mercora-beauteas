/**
 * Data access for the CAN-SPAM unsubscribe suppression list (BMC-184).
 * See lib/db/schema/email-preferences.ts.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getDbAsync } from '@/lib/db';
import { email_unsubscribes } from '@/lib/db/schema/email-preferences';
import { normalizeEmail } from '@/lib/email/unsubscribe-token';

/** An opt-out at either of these scopes suppresses review-reminder email. */
const REVIEW_REMINDER_SCOPES = ['all', 'review_reminders'];

/** True if `email` has opted out of review-reminder (or all) marketing email. */
export async function isUnsubscribedFromReviewReminders(email: string): Promise<boolean> {
  const db = await getDbAsync();
  const rows = await db
    .select({ email: email_unsubscribes.email })
    .from(email_unsubscribes)
    .where(
      and(
        eq(email_unsubscribes.email, normalizeEmail(email)),
        inArray(email_unsubscribes.scope, REVIEW_REMINDER_SCOPES),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Record an opt-out for `email` at `scope` (idempotent). */
export async function recordUnsubscribe(email: string, scope = 'review_reminders'): Promise<void> {
  const db = await getDbAsync();
  await db
    .insert(email_unsubscribes)
    .values({ email: normalizeEmail(email), scope })
    .onConflictDoNothing();
}
