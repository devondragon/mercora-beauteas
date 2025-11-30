import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import Stripe from "stripe";
import { createCoupon, listCoupons, updateCouponStripeId } from "@/lib/models/coupons";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-11-20.acacia",
});

// GET /api/coupons - List all coupons (admin only)
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

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") !== "false";

    const coupons = await listCoupons(activeOnly);
    return NextResponse.json({ data: coupons });
  } catch (error) {
    console.error("Error listing coupons:", error);
    return NextResponse.json(
      { error: "Failed to list coupons" },
      { status: 500 }
    );
  }
}

// POST /api/coupons - Create a new coupon (admin only)
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const {
      code,
      name,
      description,
      discount_type,
      discount_value,
      currency_code,
      duration,
      duration_in_months,
      max_redemptions,
      min_order_amount,
      applies_to_plans,
      valid_from,
      valid_until,
      create_in_stripe,
    } = body;

    if (!code || !name || !discount_type || !discount_value || !duration) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Create coupon in our database
    const coupon = await createCoupon({
      code,
      name,
      description,
      discount_type,
      discount_value,
      currency_code,
      duration,
      duration_in_months,
      max_redemptions,
      min_order_amount,
      applies_to_plans,
      valid_from,
      valid_until,
    });

    // Optionally create in Stripe
    if (create_in_stripe) {
      try {
        const stripeCouponParams: Stripe.CouponCreateParams = {
          name,
          duration: duration === "once" ? "once" : duration === "forever" ? "forever" : "repeating",
          ...(duration === "repeating" && duration_in_months
            ? { duration_in_months }
            : {}),
          ...(discount_type === "percentage"
            ? { percent_off: discount_value }
            : { amount_off: discount_value, currency: currency_code || "usd" }),
          ...(max_redemptions ? { max_redemptions } : {}),
          ...(valid_until ? { redeem_by: Math.floor(new Date(valid_until).getTime() / 1000) } : {}),
        };

        const stripeCoupon = await stripe.coupons.create(stripeCouponParams);

        // Create promotion code
        const promoCode = await stripe.promotionCodes.create({
          coupon: stripeCoupon.id,
          code: code.toUpperCase(),
          active: true,
        });

        await updateCouponStripeId(coupon.id, stripeCoupon.id, promoCode.id);
        coupon.stripe_coupon_id = stripeCoupon.id;
        coupon.stripe_promotion_code_id = promoCode.id;
      } catch (stripeError) {
        console.error("Failed to create Stripe coupon:", stripeError);
        // Continue without Stripe - coupon is still valid locally
      }
    }

    return NextResponse.json({ data: coupon }, { status: 201 });
  } catch (error) {
    console.error("Error creating coupon:", error);
    return NextResponse.json(
      { error: "Failed to create coupon" },
      { status: 500 }
    );
  }
}
