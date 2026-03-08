import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getCustomer, updateCustomerAddress, removeCustomerAddress } from "@/lib/models/mach/customer";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const body = await req.json() as Record<string, any>;
    const updates: any = {};

    if (body.type) updates.type = body.type;
    if (body.label !== undefined) updates.label = body.label;
    if (body.is_default !== undefined) updates.is_default = body.is_default;
    if (body.line1 || body.city || body.country) {
      updates.address = {
        line1: body.line1,
        line2: body.line2 || undefined,
        city: body.city,
        region: body.region || undefined,
        postal_code: body.postal_code || undefined,
        country: body.country,
      };
    }

    // If setting as default, unset other defaults first
    if (body.is_default) {
      const customer = await getCustomer(userId);
      if (customer?.addresses) {
        for (const addr of customer.addresses) {
          if (addr.id !== id && addr.is_default) {
            await updateCustomerAddress(userId, addr.id!, { is_default: false });
          }
        }
      }
    }

    const updated = await updateCustomerAddress(userId, id, updates);
    if (!updated) return NextResponse.json({ error: "Address not found" }, { status: 404 });

    return NextResponse.json({ success: true });
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
