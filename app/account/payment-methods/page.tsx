"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/nextjs";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  ArrowLeft,
  Plus,
  CreditCard,
  Trash2,
  Star,
  AlertCircle,
  X,
  Building2,
} from "lucide-react";
import type { CustomerPaymentMethod } from "@/lib/types/subscription";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
);

interface AddPaymentFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function AddPaymentForm({ onSuccess, onCancel }: AddPaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setAsDefault, setSetAsDefault] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(submitError.message);
      }

      const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
        elements,
      });

      if (pmError || !paymentMethod) {
        throw new Error(pmError?.message || "Failed to create payment method");
      }

      const response = await fetch("/api/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_method_id: paymentMethod.id,
          set_as_default: setAsDefault,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to add payment method");
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={setAsDefault}
          onChange={(e) => setSetAsDefault(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-600 bg-neutral-700"
        />
        <span className="text-sm text-gray-300">Set as default payment method</span>
      </label>

      {error && (
        <div className="rounded bg-red-900/50 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={!stripe || loading}
          className="flex-1 bg-orange-600 hover:bg-orange-700"
        >
          {loading ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Adding...
            </>
          ) : (
            <>
              <Plus className="mr-2 h-4 w-4" />
              Add Payment Method
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="border-neutral-600 text-gray-300"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function PaymentMethodsPage() {
  const { user, isLoaded } = useUser();
  const [paymentMethods, setPaymentMethods] = useState<CustomerPaymentMethod[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchPaymentMethods = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/payment-methods");
      if (!response.ok) {
        throw new Error("Failed to fetch payment methods");
      }
      const data = await response.json();
      setPaymentMethods(data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isLoaded && user) {
      fetchPaymentMethods();
    } else if (isLoaded && !user) {
      setLoading(false);
    }
  }, [isLoaded, user, fetchPaymentMethods]);

  const handleSetDefault = async (methodId: string) => {
    setActionLoading(methodId);

    try {
      const response = await fetch("/api/payment-methods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: methodId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to set default");
      }

      await fetchPaymentMethods();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set default");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (methodId: string) => {
    setActionLoading(methodId);

    try {
      const response = await fetch(`/api/payment-methods?id=${methodId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to remove payment method");
      }

      setDeleteConfirm(null);
      await fetchPaymentMethods();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove payment method"
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddSuccess = () => {
    setShowAddForm(false);
    fetchPaymentMethods();
  };

  const getCardIcon = (brand: string) => {
    // In a real app, you'd use actual card brand icons
    return <CreditCard className="h-6 w-6" />;
  };

  const getBrandName = (brand: string) => {
    const brands: Record<string, string> = {
      visa: "Visa",
      mastercard: "Mastercard",
      amex: "American Express",
      discover: "Discover",
      jcb: "JCB",
      diners: "Diners Club",
      unionpay: "UnionPay",
    };
    return brands[brand.toLowerCase()] || brand;
  };

  if (!isLoaded || loading) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-2xl">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-orange-400" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-2xl">
          <Card className="border-neutral-700 bg-neutral-800 p-8 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-yellow-500" />
            <h2 className="mb-2 text-xl font-semibold text-white">
              Sign In Required
            </h2>
            <p className="mb-4 text-gray-400">
              Please sign in to manage your payment methods.
            </p>
            <Button
              onClick={() => (window.location.href = "/sign-in")}
              className="bg-orange-600 hover:bg-orange-700"
            >
              Sign In
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => (window.location.href = "/account/subscriptions")}
            className="text-gray-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">Payment Methods</h1>
            <p className="text-gray-400">Manage your saved payment methods</p>
          </div>
          {!showAddForm && (
            <Button
              onClick={() => setShowAddForm(true)}
              className="bg-orange-600 hover:bg-orange-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add New
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

        {/* Add Payment Method Form */}
        {showAddForm && (
          <Card className="border-neutral-700 bg-neutral-800 p-6">
            <h2 className="mb-4 text-lg font-semibold text-white">
              Add Payment Method
            </h2>
            <Elements
              stripe={stripePromise}
              options={{
                mode: "setup",
                currency: "usd",
                appearance: {
                  theme: "night",
                  variables: {
                    colorPrimary: "#ea580c",
                    colorBackground: "#262626",
                    colorText: "#ffffff",
                    colorDanger: "#ef4444",
                  },
                },
              }}
            >
              <AddPaymentForm
                onSuccess={handleAddSuccess}
                onCancel={() => setShowAddForm(false)}
              />
            </Elements>
          </Card>
        )}

        {/* Payment Methods List */}
        {paymentMethods.length === 0 && !showAddForm ? (
          <Card className="border-neutral-700 bg-neutral-800 p-8 text-center">
            <CreditCard className="mx-auto mb-4 h-12 w-12 text-gray-600" />
            <h3 className="mb-2 text-lg font-medium text-gray-400">
              No Payment Methods
            </h3>
            <p className="mb-4 text-gray-500">
              Add a payment method to manage your subscriptions.
            </p>
            <Button
              onClick={() => setShowAddForm(true)}
              className="bg-orange-600 hover:bg-orange-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Payment Method
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {paymentMethods.map((method) => (
              <Card
                key={method.id}
                className={`border-neutral-700 bg-neutral-800 p-4 ${
                  method.is_default ? "ring-2 ring-orange-500" : ""
                }`}
              >
                {deleteConfirm === method.id ? (
                  <div className="space-y-4">
                    <p className="text-gray-300">
                      Are you sure you want to remove this payment method?
                    </p>
                    <div className="flex gap-3">
                      <Button
                        onClick={() => handleDelete(method.id)}
                        disabled={actionLoading === method.id}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        {actionLoading === method.id ? (
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        Remove
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setDeleteConfirm(null)}
                        className="border-neutral-600 text-gray-300"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded bg-neutral-700 text-gray-400">
                      {method.type === "card" ? (
                        getCardIcon(method.card_brand || "")
                      ) : (
                        <Building2 className="h-6 w-6" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white">
                          {method.type === "card"
                            ? `${getBrandName(method.card_brand || "")} •••• ${
                                method.card_last4
                              }`
                            : `${method.bank_name || "Bank"} •••• ${
                                method.bank_last4
                              }`}
                        </p>
                        {method.is_default && (
                          <span className="flex items-center gap-1 rounded bg-orange-900/50 px-2 py-0.5 text-xs text-orange-400">
                            <Star className="h-3 w-3" />
                            Default
                          </span>
                        )}
                      </div>
                      {method.type === "card" &&
                        method.card_exp_month &&
                        method.card_exp_year && (
                          <p className="text-sm text-gray-400">
                            Expires {method.card_exp_month}/{method.card_exp_year}
                          </p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!method.is_default && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetDefault(method.id)}
                          disabled={actionLoading === method.id}
                          className="text-gray-400 hover:text-white"
                        >
                          {actionLoading === method.id ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Star className="mr-1 h-4 w-4" />
                              Set Default
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirm(method.id)}
                        className="text-gray-400 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* Info Card */}
        <Card className="border-neutral-700 bg-neutral-800 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-blue-400" />
            <div className="text-sm text-gray-400">
              <p className="font-medium text-gray-300">Payment Security</p>
              <p className="mt-1">
                Your payment information is securely stored by Stripe. We never
                store your full card number.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
