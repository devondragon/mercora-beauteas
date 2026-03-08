"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { MACHCommunicationPreferences } from "@/lib/types/mach/Customer";

interface AccountSettingsProps {
  initialSettings: {
    first_name: string;
    last_name: string;
    communication_preferences: MACHCommunicationPreferences;
  };
}

export default function AccountSettings({ initialSettings }: AccountSettingsProps) {
  const [firstName, setFirstName] = useState(initialSettings.first_name);
  const [lastName, setLastName] = useState(initialSettings.last_name);
  const [emailMarketing, setEmailMarketing] = useState(
    initialSettings.communication_preferences?.email?.opted_in ?? false
  );
  const [smsMarketing, setSmsMarketing] = useState(
    initialSettings.communication_preferences?.sms?.opted_in ?? false
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/account/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          communication_preferences: {
            email: { opted_in: emailMarketing },
            sms: { opted_in: smsMarketing },
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "Failed to save settings");
      }
      toast.success("Settings saved");
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Profile */}
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5">
        <h2 className="text-lg font-semibold mb-4">Profile</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>
      </div>

      {/* Communication Preferences */}
      <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5">
        <h2 className="text-lg font-semibold mb-4">Communication Preferences</h2>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={emailMarketing}
              onChange={(e) => setEmailMarketing(e.target.checked)}
              className="rounded border-neutral-600"
            />
            <div>
              <p className="text-sm text-white">Email Marketing</p>
              <p className="text-xs text-gray-400">Receive promotions, new products, and special offers</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={smsMarketing}
              onChange={(e) => setSmsMarketing(e.target.checked)}
              className="rounded border-neutral-600"
            />
            <div>
              <p className="text-sm text-white">SMS Notifications</p>
              <p className="text-xs text-gray-400">Receive order updates and delivery notifications via text</p>
            </div>
          </label>
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={saving}
        className="bg-orange-500 hover:bg-orange-600 text-white"
      >
        {saving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );
}
