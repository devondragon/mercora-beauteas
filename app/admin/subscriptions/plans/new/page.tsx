"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save, Plus, X, RefreshCw } from "lucide-react";

export default function NewSubscriptionPlanPage() {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    interval: "month" as "day" | "week" | "month" | "year",
    interval_count: 1,
    price_amount: 0,
    currency_code: "USD",
    trial_period_days: 0,
    setup_fee_amount: 0,
    features: [] as string[],
  });
  const [newFeature, setNewFeature] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/subscription-plans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...form,
          price_amount: Math.round(form.price_amount * 100), // Convert to cents
          setup_fee_amount: form.setup_fee_amount
            ? Math.round(form.setup_fee_amount * 100)
            : 0,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create plan");
      }

      window.location.href = "/admin/subscriptions?tab=plans";
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const addFeature = () => {
    if (newFeature.trim()) {
      setForm((prev) => ({
        ...prev,
        features: [...prev.features, newFeature.trim()],
      }));
      setNewFeature("");
    }
  };

  const removeFeature = (index: number) => {
    setForm((prev) => ({
      ...prev,
      features: prev.features.filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => window.history.back()}
          className="text-gray-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white">Create Subscription Plan</h1>
          <p className="text-gray-400">Set up a new recurring billing plan</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Basic Info */}
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Basic Information</h2>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name" className="text-gray-300">
                  Plan Name *
                </Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Monthly Tea Discovery"
                  required
                  className="mt-1 border-neutral-600 bg-neutral-700 text-white"
                />
              </div>

              <div>
                <Label htmlFor="description" className="text-gray-300">
                  Description
                </Label>
                <Textarea
                  id="description"
                  value={form.description}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, description: e.target.value }))
                  }
                  placeholder="Describe what subscribers get..."
                  className="mt-1 border-neutral-600 bg-neutral-700 text-white"
                  rows={3}
                />
              </div>
            </div>
          </Card>

          {/* Pricing */}
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Pricing</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="price" className="text-gray-300">
                    Price *
                  </Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      $
                    </span>
                    <Input
                      id="price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.price_amount || ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          price_amount: parseFloat(e.target.value) || 0,
                        }))
                      }
                      required
                      className="border-neutral-600 bg-neutral-700 pl-8 text-white"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="currency" className="text-gray-300">
                    Currency
                  </Label>
                  <select
                    id="currency"
                    value={form.currency_code}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, currency_code: e.target.value }))
                    }
                    className="mt-1 w-full rounded-md border border-neutral-600 bg-neutral-700 px-3 py-2 text-white"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="interval" className="text-gray-300">
                    Billing Interval
                  </Label>
                  <select
                    id="interval"
                    value={form.interval}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        interval: e.target.value as "day" | "week" | "month" | "year",
                      }))
                    }
                    className="mt-1 w-full rounded-md border border-neutral-600 bg-neutral-700 px-3 py-2 text-white"
                  >
                    <option value="day">Daily</option>
                    <option value="week">Weekly</option>
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </div>

                <div>
                  <Label htmlFor="interval_count" className="text-gray-300">
                    Interval Count
                  </Label>
                  <Input
                    id="interval_count"
                    type="number"
                    min="1"
                    value={form.interval_count}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        interval_count: parseInt(e.target.value) || 1,
                      }))
                    }
                    className="mt-1 border-neutral-600 bg-neutral-700 text-white"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    e.g., 3 months = quarterly billing
                  </p>
                </div>
              </div>

              <div>
                <Label htmlFor="setup_fee" className="text-gray-300">
                  Setup Fee (optional)
                </Label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    $
                  </span>
                  <Input
                    id="setup_fee"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.setup_fee_amount || ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        setup_fee_amount: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="border-neutral-600 bg-neutral-700 pl-8 text-white"
                  />
                </div>
              </div>
            </div>
          </Card>

          {/* Trial Period */}
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Trial Period</h2>
            <div>
              <Label htmlFor="trial" className="text-gray-300">
                Free Trial Days
              </Label>
              <Input
                id="trial"
                type="number"
                min="0"
                value={form.trial_period_days}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    trial_period_days: parseInt(e.target.value) || 0,
                  }))
                }
                className="mt-1 border-neutral-600 bg-neutral-700 text-white"
              />
              <p className="mt-1 text-xs text-gray-500">
                Set to 0 for no trial period
              </p>
            </div>
          </Card>

          {/* Features */}
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">Features</h2>
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={newFeature}
                  onChange={(e) => setNewFeature(e.target.value)}
                  placeholder="Add a feature..."
                  className="border-neutral-600 bg-neutral-700 text-white"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFeature();
                    }
                  }}
                />
                <Button
                  type="button"
                  onClick={addFeature}
                  className="bg-neutral-700 hover:bg-neutral-600"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {form.features.length > 0 && (
                <ul className="space-y-2">
                  {form.features.map((feature, index) => (
                    <li
                      key={index}
                      className="flex items-center justify-between rounded bg-neutral-700 px-3 py-2"
                    >
                      <span className="text-gray-300">{feature}</span>
                      <button
                        type="button"
                        onClick={() => removeFeature(index)}
                        className="text-gray-400 hover:text-red-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        {error && (
          <div className="mt-4 rounded bg-red-900/50 p-4 text-red-400">{error}</div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => window.history.back()}
            className="border-neutral-600 text-gray-300"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={loading || !form.name || !form.price_amount}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {loading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Create Plan
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
