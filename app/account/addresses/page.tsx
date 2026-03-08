import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getCustomer } from "@/lib/models/mach/customer";
import AddressManager from "@/components/account/AddressManager";
import type { MACHCustomerAddress } from "@/lib/types/mach/Customer";

export const metadata = {
  title: "My Addresses - BeauTeas",
};

export default async function AddressesPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const customer = await getCustomer(userId);
  const addresses: MACHCustomerAddress[] = customer?.addresses || [];

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold mb-6">My Addresses</h1>
      <AddressManager initialAddresses={addresses} />
    </div>
  );
}
