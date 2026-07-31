/**
 * POST /api/admin/orders/[id]/shipping-email — retry or resend the shipping
 * confirmation (BMC-216C).
 *
 * Two distinct operator intents, deliberately NOT collapsed into one button:
 *
 *   retry  — the automatic send failed and nothing ever reached the customer.
 *            Reuses the stable `initial` idempotency key, so if the earlier
 *            attempt actually did land at Resend (failure reported after the
 *            handoff) the provider dedupes instead of double-sending.
 *   resend — a send succeeded and the operator deliberately wants another
 *            copy. Mints a fresh key (a reused key would be silently swallowed
 *            by Resend's 24h dedupe window) and records a distinct
 *            `shipping_email_resent` event so the audit history tells the two
 *            apart.
 *
 * Mode is checked against the recorded event history rather than trusted from
 * the client: the caller cannot decide whether a customer has already been
 * emailed.
 *
 * A failed SEND is HTTP 200 with `email.success === false` — the API call did
 * its job; delivery is a separate outcome the admin UI surfaces as a warning.
 * Nothing here touches order state: a shipped order stays shipped.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions, type AdminAuthResult } from "@/lib/auth/admin-middleware";
import { getOrderById } from "@/lib/models/mach/orders";
import { listOrderEvents, recordEmailEvent } from "@/lib/fulfillment/service";
import {
  buildShippingConfirmationData,
  initialShippingEmailKey,
} from "@/lib/fulfillment/shipping-email";
import { sendShippingConfirmationEmail } from "@/lib/utils/email";
import type { Actor, OrderEventType } from "@/lib/fulfillment/types";

type Mode = "retry" | "resend";

/**
 * Event types that prove a shipping email actually reached the customer.
 *
 * The gate's real predicate is "has a send ever succeeded", not "does a
 * `shipping_email_sent` row exist" — a `shipping_email_resent` row is equally
 * proof of delivery, and treating only the former as evidence would reopen
 * `retry` (and its reused initial key) on an order that has demonstrably been
 * emailed. A `shipping_email_failed` row is deliberately NOT here: a failed
 * automatic send is exactly the case retry exists for.
 */
const SUCCESSFUL_SEND_EVENTS: ReadonlySet<OrderEventType> = new Set<OrderEventType>([
  "shipping_email_sent",
  "shipping_email_resent",
]);

/**
 * ADMIN_VECTORIZE_TOKEN callers are automation, not a person — record them as
 * a service actor so the audit trail never implies a human clicked resend.
 */
function actorFrom(auth: AdminAuthResult): Actor {
  if (auth.isServiceToken) return { type: "service", id: "api-token" };
  return { type: "admin", id: auth.userId ?? null };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await checkAdminPermissions(request);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error || "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const mode = (body as { mode?: unknown } | null)?.mode as Mode | undefined;
  if (mode !== "retry" && mode !== "resend") {
    return NextResponse.json({ error: 'mode must be "retry" or "resend"' }, { status: 400 });
  }

  try {
    const order = await getOrderById(id);
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (order.status !== "shipped") {
      return NextResponse.json({ code: "not_shipped", status: order.status }, { status: 409 });
    }

    // History, not the client, decides which mode is legal.
    const events = await listOrderEvents(id);
    const hasSuccessfulSend = events.some((event) =>
      SUCCESSFUL_SEND_EVENTS.has(event.event_type as OrderEventType),
    );
    if (mode === "retry" && hasSuccessfulSend) {
      return NextResponse.json({ code: "wrong_mode" }, { status: 409 });
    }
    if (mode === "resend" && !hasSuccessfulSend) {
      return NextResponse.json({ code: "wrong_mode" }, { status: 409 });
    }

    // Attribute a resend to the ORIGINAL successful send, so a chain of
    // resends all point back at one root rather than at each other.
    const originalSent = events.find((event) => event.event_type === "shipping_email_sent");

    const resendEventId = mode === "resend" ? crypto.randomUUID() : null;
    const idempotencyKey =
      mode === "resend"
        ? `shipping-confirmation/${id}/resend/${resendEventId}`
        : initialShippingEmailKey(id);

    const actor = actorFrom(auth);

    const data = await buildShippingConfirmationData(order);
    if (!data) {
      // Nothing to send to. Still auditable: the operator pressed the button
      // and no email went out, which is exactly what the timeline must show.
      const eventId = await recordEmailEvent(id, "shipping_email_failed", actor, {
        idempotencyKey,
        error: "no_customer_email",
      });
      return NextResponse.json(
        { email: { success: false, error: "no_customer_email" }, eventId },
        { status: 200 },
      );
    }

    const result = await sendShippingConfirmationEmail(data, { idempotencyKey });

    if (!result.success) {
      const eventId = await recordEmailEvent(id, "shipping_email_failed", actor, {
        idempotencyKey,
        error: result.error,
      });
      return NextResponse.json(
        { email: { success: false, error: result.error }, eventId },
        { status: 200 },
      );
    }

    const eventId =
      mode === "resend"
        ? await recordEmailEvent(id, "shipping_email_resent", actor, {
            idempotencyKey,
            resendOfEventId: originalSent?.id,
          })
        : await recordEmailEvent(id, "shipping_email_sent", actor, { idempotencyKey });

    return NextResponse.json({ email: { success: true }, eventId }, { status: 200 });
  } catch (error) {
    console.error(`[shipping-email-route] failed for order ${id}:`, error);
    return NextResponse.json({ error: "Failed to send shipping email" }, { status: 500 });
  }
}
