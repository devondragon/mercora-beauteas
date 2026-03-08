import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getCustomer, updateCustomer, updateCommunicationPreferences } from "@/lib/models/mach/customer";
import type { MACHCommunicationPreferences, MACHPersonData } from "@/lib/types/mach/Customer";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const customer = await getCustomer(userId);
    if (!customer) return NextResponse.json({ settings: null });

    return NextResponse.json({
      settings: {
        display_name: customer.person?.full_name ||
          [customer.person?.first_name, customer.person?.last_name].filter(Boolean).join(" ") || "",
        first_name: customer.person?.first_name || "",
        last_name: customer.person?.last_name || "",
        communication_preferences: customer.communication_preferences || {},
      },
    });
  } catch (error) {
    console.error("Error fetching settings:", error);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json() as Record<string, unknown>;

    // Update person data (name)
    if (body.first_name !== undefined || body.last_name !== undefined) {
      const customer = await getCustomer(userId);
      if (!customer) {
        return NextResponse.json({ error: "Customer not found" }, { status: 404 });
      }
      const person = { ...(customer.person || {}) } as MACHPersonData;
      if (typeof body.first_name === "string") person.first_name = body.first_name;
      if (typeof body.last_name === "string") person.last_name = body.last_name;
      person.full_name = [person.first_name, person.last_name].filter(Boolean).join(" ");
      await updateCustomer(userId, { person });
    }

    // Update communication preferences
    if (body.communication_preferences) {
      await updateCommunicationPreferences(userId, body.communication_preferences as MACHCommunicationPreferences);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
