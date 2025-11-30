/**
 * Billing History API
 *
 * GET: List all invoices for the authenticated customer
 *
 * This endpoint efficiently fetches all invoices across all subscriptions
 * in a single query, avoiding N+1 query problems.
 */

import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { listCustomerInvoices } from "@/lib/models/subscriptions";
import { getCustomerByClerkId } from "@/lib/models/mach/customer";

/**
 * GET /api/billing-history - List all invoices for the authenticated customer
 */
export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);

    // Get customer
    const customer = await getCustomerByClerkId(user.id);
    if (!customer) {
      // Return empty array if customer doesn't exist yet
      return NextResponse.json({
        data: [],
        meta: {
          total: 0,
          schema: "billing_history",
        },
      });
    }

    // Fetch all invoices in one efficient query
    const invoices = await listCustomerInvoices(customer.id, limit);

    // Calculate totals
    const totals = invoices.reduce(
      (acc, inv) => {
        if (inv.status === "paid") {
          acc.paid += inv.amount_paid.amount;
        } else if (inv.status === "open") {
          acc.outstanding += inv.amount_due.amount - inv.amount_paid.amount;
        }
        return acc;
      },
      { paid: 0, outstanding: 0 }
    );

    return NextResponse.json({
      data: invoices,
      meta: {
        total: invoices.length,
        totals: {
          paid: totals.paid,
          outstanding: totals.outstanding,
          currency: "USD",
        },
        schema: "billing_history",
      },
    });
  } catch (error) {
    console.error("Error fetching billing history:", error);
    return NextResponse.json(
      { error: "Failed to fetch billing history" },
      { status: 500 }
    );
  }
}
