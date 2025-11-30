"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  ArrowLeft,
  Save,
  Trash2,
  AlertCircle,
  Plus,
  X,
  Archive,
  RotateCcw,
} from "lucide-react";
import type { SubscriptionPlan } from "@/lib/types/subscription";

export default function EditPlanPage() {
  const params = useParams();
  const router = useRouter();
  const planId = params.id as string;

  const [plan, setPlan] = useState<SubscriptionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "inactive" | "archived">("active");
  const [features, setFeatures] = useState<string[]>([]);
  const [newFeature, setNewFeature] = useState("");

  useEffect(() => {
    async function fetchPlan() {
      try {
        const response = await fetch(`/api/subscription-plans/${planId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch plan");
        }
        const data = await response.json();
        const planData = data.data;
        setPlan(planData);
        setName(planData.name);
        setDescription(planData.description || "");
        setStatus(planData.status);
        setFeatures(planData.features || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load plan");
      } finally {
        setLoading(false);
      }
    }

    fetchPlan();
  }, [planId]);

  const handleAddFeature = () => {
    if (newFeature.trim()) {
      setFeatures([...features, newFeature.trim()]);
      setNewFeature("");
    }
  };

  const handleRemoveFeature = (index: number) => {
    setFeatures(features.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/subscription-plans/${planId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          status,
          features,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to update plan");
      }

      const data = await response.json();
      setPlan(data.data);
      setSuccess("Plan updated successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update plan");
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/subscription-plans/${planId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "archived" }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to archive plan");
      }

      setStatus("archived");
      setShowArchiveConfirm(false);
      setSuccess("Plan archived successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive plan");
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/subscription-plans/${planId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to restore plan");
      }

      setStatus("active");
      setSuccess("Plan restored successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore plan");
    } finally {
      setSaving(false);
    }
  };

  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(amount / 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-orange-400" />
          </div>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-3xl">
          <Card className="border-neutral-700 bg-neutral-800 p-8 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-500" />
            <h2 className="mb-2 text-xl font-semibold text-white">Plan Not Found</h2>
            <p className="mb-4 text-gray-400">{error || "This plan could not be found."}</p>
            <Button
              onClick={() => router.push("/admin/subscriptions")}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Back to Plans
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push("/admin/subscriptions")}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">Edit Plan</h1>
            <p className="text-gray-400">Modify subscription plan settings</p>
          </div>
          {status === "archived" ? (
            <Button
              onClick={handleRestore}
              disabled={saving}
              className="bg-green-600 hover:bg-green-700"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Restore Plan
            </Button>
          ) : (
            <Button
              onClick={() => setShowArchiveConfirm(true)}
              variant="outline"
              className="border-red-700 text-red-400 hover:bg-red-900/30"
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive Plan
            </Button>
          )}
        </div>

        {error && (
          <Card className="border-red-700 bg-red-900/30 p-4">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setError(null)}
                className="ml-auto text-red-400"
              >
                Dismiss
              </Button>
            </div>
          </Card>
        )}

        {success && (
          <Card className="border-green-700 bg-green-900/30 p-4">
            <div className="flex items-center gap-2 text-green-400">
              <span>{success}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSuccess(null)}
                className="ml-auto text-green-400"
              >
                Dismiss
              </Button>
            </div>
          </Card>
        )}

        {/* Archive Confirmation */}
        {showArchiveConfirm && (
          <Card className="border-red-700 bg-red-900/30 p-6">
            <h3 className="mb-2 text-lg font-semibold text-white">Archive Plan?</h3>
            <p className="mb-4 text-gray-400">
              Archived plans are hidden from customers and cannot be subscribed to. Existing
              subscriptions on this plan will continue to work.
            </p>
            <div className="flex gap-3">
              <Button
                onClick={handleArchive}
                disabled={saving}
                className="bg-red-600 hover:bg-red-700"
              >
                {saving ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Archive className="mr-2 h-4 w-4" />
                )}
                Archive Plan
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowArchiveConfirm(false)}
                className="border-neutral-600 text-gray-300"
              >
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {/* Read-Only Pricing Info */}
        <Card className="border-neutral-700 bg-neutral-800 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Pricing (Read-Only)</h2>
          <p className="mb-4 text-sm text-gray-400">
            Pricing cannot be changed after plan creation. To change pricing, create a new plan
            and migrate existing subscribers.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded bg-neutral-700 p-4">
              <p className="text-sm text-gray-400">Price</p>
              <p className="text-xl font-bold text-white">
                {formatPrice(plan.price.amount, plan.price.currency)}/{plan.interval}
              </p>
            </div>
            <div className="rounded bg-neutral-700 p-4">
              <p className="text-sm text-gray-400">Billing Interval</p>
              <p className="text-xl font-bold text-white capitalize">
                Every {plan.interval_count > 1 ? `${plan.interval_count} ` : ""}
                {plan.interval}
                {plan.interval_count > 1 ? "s" : ""}
              </p>
            </div>
            {plan.trial_period_days > 0 && (
              <div className="rounded bg-neutral-700 p-4">
                <p className="text-sm text-gray-400">Trial Period</p>
                <p className="text-xl font-bold text-white">{plan.trial_period_days} days</p>
              </div>
            )}
            {plan.setup_fee && plan.setup_fee.amount > 0 && (
              <div className="rounded bg-neutral-700 p-4">
                <p className="text-sm text-gray-400">Setup Fee</p>
                <p className="text-xl font-bold text-white">
                  {formatPrice(plan.setup_fee.amount, plan.setup_fee.currency)}
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Editable Fields */}
        <Card className="border-neutral-700 bg-neutral-800 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Plan Details</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">Plan Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded bg-neutral-700 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Enter plan name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded bg-neutral-700 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Describe what's included in this plan"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-300">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="w-full rounded bg-neutral-700 px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="archived">Archived</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Active plans are visible to customers. Inactive plans are hidden but can be
                reactivated.
              </p>
            </div>
          </div>
        </Card>

        {/* Features */}
        <Card className="border-neutral-700 bg-neutral-800 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Features</h2>
          <p className="mb-4 text-sm text-gray-400">
            List the features included in this subscription plan.
          </p>

          <div className="space-y-3">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex items-center gap-3 rounded bg-neutral-700 px-4 py-2"
              >
                <span className="flex-1 text-white">{feature}</span>
                <button
                  onClick={() => handleRemoveFeature(index)}
                  className="text-gray-400 hover:text-red-400"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}

            <div className="flex gap-2">
              <input
                type="text"
                value={newFeature}
                onChange={(e) => setNewFeature(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddFeature()}
                className="flex-1 rounded bg-neutral-700 px-4 py-2 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Add a feature"
              />
              <Button onClick={handleAddFeature} className="bg-neutral-600 hover:bg-neutral-500">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Stripe Info */}
        {(plan.stripe_product_id || plan.stripe_price_id) && (
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Stripe Integration</h2>
            <div className="space-y-2 text-sm">
              {plan.stripe_product_id && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Product ID:</span>
                  <code className="text-orange-400">{plan.stripe_product_id}</code>
                </div>
              )}
              {plan.stripe_price_id && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Price ID:</span>
                  <code className="text-orange-400">{plan.stripe_price_id}</code>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Save Button */}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => router.push("/admin/subscriptions")}
            className="border-neutral-600 text-gray-300"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {saving ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
