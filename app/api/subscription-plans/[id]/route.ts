import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import {
  getSubscriptionPlan,
  updateSubscriptionPlan,
} from "@/lib/models/subscriptions";

// GET /api/subscription-plans/[id] - Get a specific plan
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const plan = await getSubscriptionPlan(id);

    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    return NextResponse.json({ data: plan });
  } catch (error) {
    console.error("Error fetching plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch plan" },
      { status: 500 }
    );
  }
}

// PUT /api/subscription-plans/[id] - Update a plan
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin (you may want to implement proper role checking)
    const isAdmin =
      user.publicMetadata?.role === "admin" ||
      user.privateMetadata?.role === "admin";

    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, description, status, features, metadata } = body;

    const plan = await updateSubscriptionPlan(id, {
      name,
      description,
      status,
      features,
      metadata,
    });

    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    return NextResponse.json({ data: plan });
  } catch (error) {
    console.error("Error updating plan:", error);
    return NextResponse.json(
      { error: "Failed to update plan" },
      { status: 500 }
    );
  }
}
