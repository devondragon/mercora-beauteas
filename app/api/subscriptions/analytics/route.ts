import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { eq, sql, and, gte, count } from "drizzle-orm";
import { getDbAsync } from "@/lib/db";
import {
  subscriptions,
  subscription_plans,
  subscription_invoices,
  subscription_events,
} from "@/lib/db/schema/subscriptions";
import {
  getActiveSubscriptionCount,
  getMonthlyRecurringRevenue,
} from "@/lib/models/subscriptions";

// GET /api/subscriptions/analytics - Get subscription analytics data
export async function GET(request: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin =
      user.publicMetadata?.role === "admin" ||
      user.privateMetadata?.role === "admin";

    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const db = await getDbAsync();
    const now = new Date();

    // Get basic metrics
    const activeCount = await getActiveSubscriptionCount();
    const mrr = await getMonthlyRecurringRevenue();

    // Calculate dates for time-based queries
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Count subscriptions by status
    const statusCounts = await db
      .select({
        status: subscriptions.status,
        count: count(),
      })
      .from(subscriptions)
      .groupBy(subscriptions.status);

    const statusBreakdown: Record<string, number> = {};
    for (const row of statusCounts) {
      statusBreakdown[row.status] = row.count;
    }

    // Count new subscriptions in last 30 days
    const newSubscriptions = await db
      .select({ count: count() })
      .from(subscriptions)
      .where(gte(subscriptions.created_at, thirtyDaysAgo.toISOString()));

    // Count cancellations in last 30 days
    const cancellations = await db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.status, "cancelled"),
          gte(subscriptions.cancelled_at, thirtyDaysAgo.toISOString())
        )
      );

    // Calculate churn rate (cancellations / active at start of period)
    const activeAtStartOfPeriod = await db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          gte(subscriptions.created_at, sixtyDaysAgo.toISOString()),
          // Simplified - in production would need more accurate calculation
          sql`${subscriptions.status} IN ('active', 'trialing', 'paused', 'past_due', 'cancelled')`
        )
      );

    const startCount = activeAtStartOfPeriod[0]?.count || 1;
    const cancelCount = cancellations[0]?.count || 0;
    const churnRate = (cancelCount / startCount) * 100;

    // Revenue from paid invoices in last 30 days
    const revenueResult = await db
      .select({
        total: sql<number>`COALESCE(SUM(amount_paid), 0)`,
      })
      .from(subscription_invoices)
      .where(
        and(
          eq(subscription_invoices.status, "paid"),
          gte(subscription_invoices.paid_at, thirtyDaysAgo.toISOString())
        )
      );

    const revenue30Days = revenueResult[0]?.total || 0;

    // Get plan distribution
    const planDistribution = await db
      .select({
        plan_id: subscriptions.plan_id,
        plan_name: subscription_plans.name,
        count: count(),
      })
      .from(subscriptions)
      .innerJoin(subscription_plans, eq(subscriptions.plan_id, subscription_plans.id))
      .where(
        sql`${subscriptions.status} IN ('active', 'trialing')`
      )
      .groupBy(subscriptions.plan_id, subscription_plans.name);

    // Get recent events for activity feed
    const recentEvents = await db
      .select({
        id: subscription_events.id,
        subscription_id: subscription_events.subscription_id,
        event_type: subscription_events.event_type,
        created_at: subscription_events.created_at,
      })
      .from(subscription_events)
      .orderBy(sql`${subscription_events.created_at} DESC`)
      .limit(20);

    // Calculate growth rate
    const lastMonthNew = await db
      .select({ count: count() })
      .from(subscriptions)
      .where(
        and(
          gte(subscriptions.created_at, sixtyDaysAgo.toISOString()),
          sql`${subscriptions.created_at} < ${thirtyDaysAgo.toISOString()}`
        )
      );

    const thisMonthNewCount = newSubscriptions[0]?.count || 0;
    const lastMonthNewCount = lastMonthNew[0]?.count || 1;
    const growthRate = ((thisMonthNewCount - lastMonthNewCount) / lastMonthNewCount) * 100;

    // Trial conversion rate (simplified)
    const trialsStarted = await db
      .select({ count: count() })
      .from(subscription_events)
      .where(
        and(
          eq(subscription_events.event_type, "trial_started"),
          gte(subscription_events.created_at, sixtyDaysAgo.toISOString())
        )
      );

    const trialsConverted = await db
      .select({ count: count() })
      .from(subscription_events)
      .where(
        and(
          eq(subscription_events.event_type, "activated"),
          gte(subscription_events.created_at, sixtyDaysAgo.toISOString())
        )
      );

    const trialsStartedCount = trialsStarted[0]?.count || 1;
    const trialsConvertedCount = trialsConverted[0]?.count || 0;
    const trialConversionRate = (trialsConvertedCount / trialsStartedCount) * 100;

    // Average revenue per user (ARPU)
    const arpu = activeCount > 0 ? mrr / activeCount : 0;

    return NextResponse.json({
      data: {
        // Core metrics
        mrr,
        arr: mrr * 12,
        activeSubscriptions: activeCount,

        // Status breakdown
        statusBreakdown,

        // Growth metrics
        newSubscriptions30Days: thisMonthNewCount,
        cancellations30Days: cancelCount,
        churnRate: Math.round(churnRate * 100) / 100,
        growthRate: Math.round(growthRate * 100) / 100,

        // Revenue metrics
        revenue30Days,
        arpu: Math.round(arpu),

        // Conversion metrics
        trialConversionRate: Math.round(trialConversionRate * 100) / 100,

        // Distribution
        planDistribution: planDistribution.map((p) => ({
          planId: p.plan_id,
          planName: p.plan_name,
          count: p.count,
        })),

        // Activity
        recentEvents: recentEvents.map((e) => ({
          id: e.id,
          subscriptionId: e.subscription_id,
          eventType: e.event_type,
          createdAt: e.created_at,
        })),

        // Metadata
        generatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return NextResponse.json(
      { error: "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
