"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MapPin, Plus, Pencil, Trash2, Star } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { MACHCustomerAddress } from "@/lib/types/mach/Customer";

interface AddressManagerProps {
  initialAddresses: MACHCustomerAddress[];
}

interface AddressFormData {
  label: string;
  type: "shipping" | "billing";
  line1: string;
  line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  is_default: boolean;
}

const emptyForm: AddressFormData = {
  label: "",
  type: "shipping",
  line1: "",
  line2: "",
  city: "",
  region: "",
  postal_code: "",
  country: "US",
  is_default: false,
};

function getDisplayAddress(addr: MACHCustomerAddress): string {
  const a = addr.address;
  if (!a) return "—";
  const line1 = typeof a.line1 === "string" ? a.line1 : "";
  const city = typeof a.city === "string" ? a.city : "";
  return [line1, a.line2, [city, a.region, a.postal_code].filter(Boolean).join(", "), a.country]
    .filter(Boolean)
    .join("\n");
}

export default function AddressManager({ initialAddresses }: AddressManagerProps) {
  const router = useRouter();
  const [addresses, setAddresses] = useState(initialAddresses);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressFormData>(emptyForm);
  const [saving, setSaving] = useState(false);

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(addr: MACHCustomerAddress) {
    setEditingId(addr.id || null);
    setForm({
      label: addr.label || "",
      type: (addr.type as "shipping" | "billing") || "shipping",
      line1: typeof addr.address?.line1 === "string" ? addr.address.line1 : "",
      line2: (typeof addr.address?.line2 === "string" ? addr.address.line2 : "") || "",
      city: typeof addr.address?.city === "string" ? addr.address.city : "",
      region: addr.address?.region || "",
      postal_code: addr.address?.postal_code || "",
      country: addr.address?.country || "US",
      is_default: addr.is_default || false,
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const url = editingId
        ? `/api/account/addresses/${editingId}`
        : "/api/account/addresses";
      const method = editingId ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save address");
      }

      toast.success(editingId ? "Address updated" : "Address added");
      setShowForm(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/account/addresses/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete address");
      toast.success("Address removed");
      router.refresh();
    } catch (error) {
      toast.error("Failed to delete address");
    }
  }

  async function handleSetDefault(id: string) {
    try {
      const res = await fetch(`/api/account/addresses/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_default: true }),
      });
      if (!res.ok) throw new Error("Failed to set default");
      toast.success("Default address updated");
      router.refresh();
    } catch (error) {
      toast.error("Failed to update default address");
    }
  }

  // Empty state
  if (addresses.length === 0 && !showForm) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <MapPin className="h-12 w-12 text-neutral-600 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">No addresses saved</h2>
        <p className="text-neutral-400 mb-6 max-w-md">
          Add a shipping or billing address to speed up checkout.
        </p>
        <Button onClick={openAdd} className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Address
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button onClick={openAdd} className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Add Address
        </Button>
      </div>

      {/* Address form modal */}
      {showForm && (
        <div className="bg-neutral-800 border border-neutral-700 rounded-lg p-5 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            {editingId ? "Edit Address" : "New Address"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Label (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Home, Work"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as "shipping" | "billing" })}
                  className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                >
                  <option value="shipping">Shipping</option>
                  <option value="billing">Billing</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Address Line 1 *</label>
              <input
                type="text"
                required
                value={form.line1}
                onChange={(e) => setForm({ ...form, line1: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Address Line 2</label>
              <input
                type="text"
                value={form.line2}
                onChange={(e) => setForm({ ...form, line2: e.target.value })}
                className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">City *</label>
                <input
                  type="text"
                  required
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">State / Region</label>
                <input
                  type="text"
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Postal Code</label>
                <input
                  type="text"
                  value={form.postal_code}
                  onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                  className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Country *</label>
                <input
                  type="text"
                  required
                  maxLength={2}
                  placeholder="US"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
                  className="w-full bg-neutral-900 border border-neutral-600 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
                    className="rounded border-neutral-600"
                  />
                  Set as default address
                </label>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={saving}
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                {saving ? "Saving..." : editingId ? "Update Address" : "Add Address"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
                className="border-neutral-600 text-gray-300 hover:text-white"
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Address cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {addresses.map((addr) => (
          <div
            key={addr.id}
            className="bg-neutral-800 border border-neutral-700 rounded-lg p-5 relative"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                {addr.label && (
                  <span className="text-white font-medium">{addr.label}</span>
                )}
                <span className="inline-flex items-center rounded-full bg-neutral-700 px-2 py-0.5 text-xs text-gray-300 capitalize">
                  {addr.type}
                </span>
                {addr.is_default && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-xs text-orange-400">
                    <Star className="h-3 w-3" />
                    Default
                  </span>
                )}
              </div>
            </div>
            <p className="text-sm text-gray-300 whitespace-pre-line mb-4">
              {getDisplayAddress(addr)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEdit(addr)}
                className="border-neutral-600 text-gray-300 hover:text-white"
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
              {!addr.is_default && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetDefault(addr.id!)}
                  className="border-neutral-600 text-gray-300 hover:text-white"
                >
                  <Star className="h-3 w-3 mr-1" />
                  Set Default
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-red-800 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-neutral-800 border-neutral-700">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">Delete Address?</AlertDialogTitle>
                    <AlertDialogDescription className="text-neutral-400">
                      This will permanently remove this address from your account.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-neutral-600 text-neutral-300 hover:text-white bg-transparent hover:bg-neutral-700">
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleDelete(addr.id!)}
                      className="bg-red-500 hover:bg-red-600 text-white"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
