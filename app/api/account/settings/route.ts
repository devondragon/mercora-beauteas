import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getCustomer, updateCustomer, updateCommunicationPreferences } from "@/lib/models/mach/customer";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
}

export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json() as Record<string, any>;

    // Update person data (name)
    if (body.first_name !== undefined || body.last_name !== undefined) {
      const customer = await getCustomer(userId);
      if (customer) {
        const person: Record<string, any> = { ...customer.person };
        if (body.first_name !== undefined) person.first_name = body.first_name;
        if (body.last_name !== undefined) person.last_name = body.last_name;
        person.full_name = [person.first_name, person.last_name].filter(Boolean).join(" ");
        await updateCustomer(userId, { person } as any);
      }
    }

    // Update communication preferences
    if (body.communication_preferences) {
      await updateCommunicationPreferences(userId, body.communication_preferences);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating settings:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
