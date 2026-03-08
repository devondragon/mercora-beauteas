import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getCustomer, addCustomerAddress, updateCustomerAddress } from "@/lib/models/mach/customer";
import type { MACHCustomerAddress } from "@/lib/types/mach/Customer";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const customer = await getCustomer(userId);
    if (!customer) return NextResponse.json({ addresses: [] });
    return NextResponse.json({ addresses: customer.addresses || [] });
  } catch (error) {
    console.error("Error fetching addresses:", error);
    return NextResponse.json({ error: "Failed to load addresses" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json() as Record<string, unknown>;

    if (!body.line1 || typeof body.line1 !== "string")
      return NextResponse.json({ error: "line1 is required" }, { status: 400 });
    if (!body.city || typeof body.city !== "string")
      return NextResponse.json({ error: "city is required" }, { status: 400 });
    if (!body.country || typeof body.country !== "string" || body.country.length !== 2)
      return NextResponse.json({ error: "country must be a 2-letter ISO code" }, { status: 400 });

    // If new address is default, unset existing defaults first
    if (body.is_default === true) {
      const customer = await getCustomer(userId);
      if (customer?.addresses) {
        for (const addr of customer.addresses) {
          if (addr.is_default && addr.id) {
            await updateCustomerAddress(userId, addr.id, { is_default: false });
          }
        }
      }
    }

    const address: MACHCustomerAddress = {
      id: `addr_${crypto.randomUUID()}`,
      type: (body.type === "billing" ? "billing" : "shipping"),
      label: typeof body.label === "string" ? body.label : undefined,
      is_default: body.is_default === true,
      address: {
        line1: body.line1,
        line2: typeof body.line2 === "string" ? body.line2 : undefined,
        city: body.city,
        region: typeof body.region === "string" ? body.region : undefined,
        postal_code: typeof body.postal_code === "string" ? body.postal_code : undefined,
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
