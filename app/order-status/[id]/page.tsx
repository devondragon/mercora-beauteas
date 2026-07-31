/**
 * === Guest Order Status (BMC-216E) ===
 *
 * Guest checkout leaves customers with no account to log into, so the shipping
 * email links here with an HMAC bearer token:
 *
 *   ${BASE_URL}/order-status/<orderId>?token=<token>
 *
 * The token is a signature over `order-status:v1:<orderId>:<email>` — it carries
 * no payload, so the page must re-derive the email from the order and verify
 * against it (lib/order-status/token.ts).
 *
 * FAIL-CLOSED FLOW — the order matters:
 *   1. rate limit by client IP (PUBLIC_RATE_LIMITER, BMC-180 convention)
 *   2. token present in the query
 *   3. order exists
 *   4. the order resolves to a customer email
 *   5. the signature verifies for THIS order + THIS email
 * Every failure returns notFound(). Identical outcomes for "no such order",
 * "no email on file", "wrong token", and "throttled" mean a stranger cannot use
 * the (enumerable) order id as an existence oracle. Steps 1–2 run before the D1
 * read so a flood is turned away by the rate limiter first — it still costs a
 * D1 read once past that gate (middleware.ts and the Footer already issue
 * uncached D1 reads per request, so this page is not a new class of exposure,
 * but it is not free of database load).
 *
 * The rendered page is built ONLY from buildGuestOrderProjection — see that
 * module for the allowlist. Metadata is noindex + no-referrer so the token in
 * this URL is not indexed and is not forwarded in the Referer header when the
 * customer clicks through to the carrier's site.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getOrderById } from "@/lib/models/mach/orders";
import { getOrderCustomerEmail } from "@/lib/orders/customer-email";
import { verifyOrderStatusToken } from "@/lib/order-status/token";
import { buildGuestOrderProjection } from "@/lib/order-status/guest-projection";
import { enforceRateLimit, getClientIpFromHeaders } from "@/lib/rate-limit";
import { formatDate } from "@/lib/utils/account";

export const metadata: Metadata = {
  title: "Order Status - BeauTeas",
  // noindex: the URL contains a bearer token. no-referrer: the outbound carrier
  // link must not forward that token in the Referer header.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

// This response is per-token and must never be cached — declared locally
// rather than relying solely on the root layout's `force-dynamic` (see the
// root-loading.tsx trap warning in app/layout.tsx: that inheritance is
// documented as fragile, and a token-bearing page is exactly the case that
// must not depend on it).
export const dynamic = "force-dynamic";

export default async function GuestOrderStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);

  const limited = await enforceRateLimit(
    "PUBLIC_RATE_LIMITER",
    `order-status:${getClientIpFromHeaders(await headers())}`,
  );
  if (limited) notFound();

  // A repeated ?token= yields an array; treat anything but a single string as absent.
  const token = typeof query.token === "string" ? query.token : null;
  if (!token) notFound();

  const order = await getOrderById(id);
  if (!order) notFound();

  const email = getOrderCustomerEmail(order);
  if (!email) notFound();

  const verified = await verifyOrderStatusToken(token, id, email);
  if (!verified) notFound();

  const view = buildGuestOrderProjection(order);

  return (
    <div className="min-h-screen px-4 py-12">
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-sm text-text-secondary">BeauTeas order status</p>
        <h1 className="text-2xl font-bold text-text-primary mt-1 break-all">
          Order {view.orderNumber}
        </h1>
        <p className="text-sm text-text-secondary mt-1">Placed {formatDate(view.placedAt)}</p>

        <div className="bg-white border border-border-default rounded-lg p-5 mt-6">
          <h2 className="text-sm font-medium text-text-secondary mb-2">Status</h2>
          <p className="text-lg font-semibold text-text-primary capitalize">
            {view.status.replace(/_/g, " ")}
          </p>
        </div>

        {view.shippedAt && (
          <div className="bg-white border border-border-default rounded-lg p-5 mt-4">
            <h2 className="text-sm font-medium text-text-secondary mb-3">Shipment</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-text-secondary">Shipped</dt>
                <dd className="text-text-primary">{formatDate(view.shippedAt)}</dd>
              </div>
              {view.carrierLabel && (
                <div className="flex justify-between gap-4">
                  <dt className="text-text-secondary">Carrier</dt>
                  <dd className="text-text-primary">{view.carrierLabel}</dd>
                </div>
              )}
              {view.trackingNumber && (
                <div className="flex justify-between gap-4">
                  <dt className="text-text-secondary">Tracking number</dt>
                  <dd className="text-text-primary font-mono break-all">{view.trackingNumber}</dd>
                </div>
              )}
            </dl>
            {view.trackingUrl && (
              <a
                href={view.trackingUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center mt-4 text-sm font-medium text-primary-700 underline hover:text-primary-900"
              >
                Track your package
              </a>
            )}
          </div>
        )}

        <div className="bg-white border border-border-default rounded-lg p-5 mt-4">
          <h2 className="text-sm font-medium text-text-secondary mb-3">Items</h2>
          <ul className="space-y-2">
            {view.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-4 text-sm">
                <span className="text-text-primary">{item.name}</span>
                <span className="text-text-secondary">Qty: {item.quantity}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-sm text-text-secondary mt-6">
          Questions about this order?{" "}
          <Link href="/contact" className="text-primary-700 underline hover:text-primary-900">
            Contact us
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
