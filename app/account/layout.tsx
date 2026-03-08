import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AccountSidebar from "@/components/account/AccountSidebar";

export const metadata = {
  title: "My Account - BeauTeas",
  description: "Manage your BeauTeas account",
};

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <main className="bg-neutral-900 text-white min-h-screen px-4 sm:px-6 lg:px-12 py-12 sm:py-16">
      <div className="max-w-6xl mx-auto">
        {/* Mobile nav (horizontal strip at top) */}
        <div className="md:hidden">
          <AccountSidebar />
        </div>
        {/* Desktop layout with sidebar */}
        <div className="md:flex md:gap-8">
          <div className="hidden md:block">
            <AccountSidebar />
          </div>
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </div>
    </main>
  );
}
