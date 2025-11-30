import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import {
  getCouponByCode,
  validateCoupon,
  calculateDiscount,
  updateCoupon,
} from "@/lib/models/coupons";

// GET /api/coupons/[code] - Validate a coupon code
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get("plan_id") ?? undefined;
    const orderAmountStr = searchParams.get("order_amount");
    const orderAmount = orderAmountStr ? parseInt(orderAmountStr, 10) : undefined;

    const { valid, coupon, error } = await validateCoupon(code, planId, orderAmount);

    if (!valid || !coupon) {
      return NextResponse.json(
        { valid: false, error: error || "Invalid coupon" },
        { status: 400 }
      );
    }

    // Calculate discount if order amount provided
    let discountAmount: number | undefined;
    if (orderAmount) {
      discountAmount = await calculateDiscount(coupon, orderAmount);
    }

    return NextResponse.json({
      valid: true,
      data: {
        id: coupon.id,
        code: coupon.code,
        name: coupon.name,
        description: coupon.description,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        duration: coupon.duration,
        discount_amount: discountAmount,
      },
    });
  } catch (error) {
    console.error("Error validating coupon:", error);
    return NextResponse.json(
      { valid: false, error: "Failed to validate coupon" },
      { status: 500 }
    );
  }
}

// PUT /api/coupons/[code] - Update a coupon (admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
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

    const { code } = await params;
    const coupon = await getCouponByCode(code);

    if (!coupon) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, description, is_active, valid_until, max_redemptions } = body;

    const updated = await updateCoupon(coupon.id, {
      name,
      description,
      is_active,
      valid_until,
      max_redemptions,
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("Error updating coupon:", error);
    return NextResponse.json(
      { error: "Failed to update coupon" },
      { status: 500 }
    );
  }
}

// DELETE /api/coupons/[code] - Deactivate a coupon (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
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

    const { code } = await params;
    const coupon = await getCouponByCode(code);

    if (!coupon) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }

    await updateCoupon(coupon.id, { is_active: false });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deactivating coupon:", error);
    return NextResponse.json(
      { error: "Failed to deactivate coupon" },
      { status: 500 }
    );
  }
}
