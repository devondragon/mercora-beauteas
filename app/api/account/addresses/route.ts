import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getCustomer, addCustomerAddress } from "@/lib/models/mach/customer";
import type { MACHCustomerAddress } from "@/lib/types/mach/Customer";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const customer = await getCustomer(userId);
  if (!customer) return NextResponse.json({ addresses: [] });

  return NextResponse.json({ addresses: customer.addresses || [] });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const address: MACHCustomerAddress = {
      id: `addr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type: body.type || "shipping",
      label: body.label,
      is_default: body.is_default || false,
      address: {
        line1: body.line1,
        line2: body.line2 || undefined,
        city: body.city,
        region: body.region || undefined,
        postal_code: body.postal_code || undefined,
        country: body.country,
      },
    };

    const updated = await addCustomerAddress(userId, address);
    if (!updated) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    console.error("Error creating address:", error);
    return NextResponse.json({ error: "Failed to create address" }, { status: 500 });
  }
}
