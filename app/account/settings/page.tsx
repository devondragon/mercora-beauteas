import { auth } from "@clerk/nextjs/server";
import { getCustomer } from "@/lib/models/mach/customer";
import AccountSettings from "@/components/account/AccountSettings";
import { UserProfile } from "@clerk/nextjs";

export const metadata = {
  title: "Account Settings - BeauTeas",
};

export default async function SettingsPage() {
  const { userId } = await auth();
  const customer = userId ? await getCustomer(userId) : null;

  const settings = {
    first_name: customer?.person?.first_name || "",
    last_name: customer?.person?.last_name || "",
    communication_preferences: customer?.communication_preferences || {},
  };

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold mb-6">Settings</h1>
      <AccountSettings initialSettings={settings} />

      {/* Clerk UserProfile for email, password, 2FA management */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Security &amp; Authentication</h2>
        <div className="rounded-lg overflow-hidden">
          <UserProfile
            appearance={{
              baseTheme: undefined,
              elements: {
                rootBox: "w-full",
                cardBox: "w-full shadow-none",
                card: "bg-neutral-800 border border-neutral-700 shadow-none",
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
