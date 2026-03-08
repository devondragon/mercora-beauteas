import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getCustomer, updateCustomerAddress, removeCustomerAddress } from "@/lib/models/mach/customer";
import type { MACHCustomerAddress } from "@/lib/types/mach/Customer";
import type { MACHAddress } from "@/lib/types/mach/Address";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const body = await req.json() as Record<string, unknown>;

    if (body.type !== undefined && body.type !== "shipping" && body.type !== "billing")
      return NextResponse.json({ error: "type must be 'shipping' or 'billing'" }, { status: 400 });
    if (body.country !== undefined && (typeof body.country !== "string" || body.country.length !== 2))
      return NextResponse.json({ error: "country must be a 2-letter ISO code" }, { status: 400 });

    const MAX_FIELD_LEN = 200;
    for (const field of ["line1", "line2", "city", "region", "postal_code", "label"] as const) {
      if (typeof body[field] === "string" && (body[field] as string).length > MAX_FIELD_LEN)
        return NextResponse.json({ error: `${field} exceeds ${MAX_FIELD_LEN} characters` }, { status: 400 });
    }

    const customer = await getCustomer(userId);
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const updates: Partial<MACHCustomerAddress> = {};

    if (body.type) updates.type = body.type as MACHCustomerAddress["type"];
    if (body.label !== undefined) updates.label = typeof body.label === "string" ? body.label : undefined;
    if (body.is_default !== undefined) updates.is_default = Boolean(body.is_default);
    if (body.line1 !== undefined || body.line2 !== undefined || body.city !== undefined ||
        body.region !== undefined || body.postal_code !== undefined || body.country !== undefined) {
      // Read existing address to merge — prevents partial updates from destroying fields
      const existingAddr = customer.addresses?.find((a) => a.id === id);
      const existingAddress: Partial<MACHAddress> = existingAddr?.address || {};

      updates.address = {
        line1: body.line1 !== undefined ? (body.line1 as string) : (typeof existingAddress.line1 === "string" ? existingAddress.line1 : ""),
        line2: body.line2 !== undefined ? (typeof body.line2 === "string" ? body.line2 : undefined) : (typeof existingAddress.line2 === "string" ? existingAddress.line2 : undefined),
        city: body.city !== undefined ? (body.city as string) : (typeof existingAddress.city === "string" ? existingAddress.city : ""),
        region: body.region !== undefined ? (typeof body.region === "string" ? body.region : undefined) : (existingAddress.region as string | undefined),
        postal_code: body.postal_code !== undefined ? (typeof body.postal_code === "string" ? body.postal_code : undefined) : (existingAddress.postal_code as string | undefined),
        country: body.country !== undefined ? (body.country as string) : (typeof existingAddress.country === "string" ? existingAddress.country : ""),
      };
    }

    // If setting as default, unset other defaults first
    if (body.is_default && customer.addresses) {
      for (const addr of customer.addresses) {
        if (addr.id !== id && addr.is_default && addr.id) {
          await updateCustomerAddress(userId, addr.id, { is_default: false });
        }
      }
    }

    const updated = await updateCustomerAddress(userId, id, updates);
    if (!updated) return NextResponse.json({ error: "Address not found" }, { status: 404 });

    const updatedAddress = updated.addresses?.find((a) => a.id === id);
    return NextResponse.json({ success: true, address: updatedAddress });
  } catch (error) {
    console.error("Error updating address:", error);
    return NextResponse.json({ error: "Failed to update address" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const updated = await removeCustomerAddress(userId, id);
    if (!updated) return NextResponse.json({ error: "Address not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting address:", error);
    return NextResponse.json({ error: "Failed to delete address" }, { status: 500 });
  }
}
