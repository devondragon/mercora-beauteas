"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw,
  Gift,
  Check,
  AlertCircle,
  User,
  MessageSquare,
  ArrowRight,
} from "lucide-react";

interface GiftData {
  id: string;
  sender_name: string;
  gift_message?: string;
  plan: {
    id: string;
    name: string;
    description?: string;
    price: { amount: number; currency: string };
    interval: string;
  };
  expires_at?: string;
}

export default function RedeemGiftPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, isLoaded } = useUser();

  const [code, setCode] = useState(searchParams.get("code") || "");
  const [giftData, setGiftData] = useState<GiftData | null>(null);
  const [loading, setLoading] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);

  useEffect(() => {
    const codeParam = searchParams.get("code");
    if (codeParam) {
      setCode(codeParam);
      validateCode(codeParam);
    }
  }, [searchParams]);

  const validateCode = async (codeToValidate: string) => {
    if (!codeToValidate.trim()) return;

    setLoading(true);
    setError(null);
    setGiftData(null);

    try {
      const response = await fetch(
        `/api/gift-subscriptions?code=${encodeURIComponent(codeToValidate.trim())}`
      );
      const data = await response.json();

      if (!response.ok || !data.valid) {
        throw new Error(data.error || "Invalid code");
      }

      setGiftData(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to validate code");
    } finally {
      setLoading(false);
    }
  };

  const handleRedeem = async () => {
    if (!user) {
      window.location.href = `/sign-in?redirect_url=${encodeURIComponent(
        `/gift/redeem?code=${code}`
      )}`;
      return;
    }

    setRedeeming(true);
    setError(null);

    try {
      const response = await fetch("/api/gift-subscriptions/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redeem_code: code }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to redeem gift");
      }

      setSuccess(true);
      setSubscriptionId(data.data.subscription_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to redeem gift");
    } finally {
      setRedeeming(false);
    }
  };

  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency,
    }).format(amount / 100);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-neutral-900 p-6">
        <div className="mx-auto max-w-lg space-y-6 text-center">
          <div className="flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-green-600">
              <Check className="h-10 w-10 text-white" />
            </div>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-white">Gift Redeemed!</h1>
            <p className="mt-2 text-gray-400">
              Your subscription is now active. Enjoy!
            </p>
          </div>

          {giftData && (
            <Card className="border-neutral-700 bg-neutral-800 p-6 text-left">
              <p className="text-gray-400">
                Thanks to <span className="text-white">{giftData.sender_name}</span>,
                you now have access to:
              </p>
              <p className="mt-2 text-xl font-bold text-orange-400">
                {giftData.plan.name}
              </p>
            </Card>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button
              onClick={() => router.push(`/account/subscriptions/${subscriptionId}`)}
              className="bg-orange-600 hover:bg-orange-700"
            >
              View Subscription
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/")}
              className="border-neutral-600 text-gray-300"
            >
              Start Shopping
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 p-6">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-orange-600">
            <Gift className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Redeem Your Gift</h1>
          <p className="mt-2 text-gray-400">
            Enter your gift code to activate your subscription
          </p>
        </div>

        {error && (
          <Card className="border-red-700 bg-red-900/30 p-4">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          </Card>
        )}

        {/* Code Input */}
        <Card className="border-neutral-700 bg-neutral-800 p-6">
          <label className="mb-2 block text-sm font-medium text-gray-300">
            Gift Code
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="flex-1 rounded bg-neutral-700 px-4 py-3 text-center text-xl font-mono tracking-wider text-white placeholder-gray-500 uppercase focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="ENTER CODE"
              maxLength={10}
            />
            <Button
              onClick={() => validateCode(code)}
              disabled={loading || !code.trim()}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {loading ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : (
                "Validate"
              )}
            </Button>
          </div>
        </Card>

        {/* Gift Details */}
        {giftData && (
          <>
            <Card className="border-green-700 bg-green-900/30 p-6">
              <div className="mb-4 flex items-center gap-2 text-green-400">
                <Check className="h-5 w-5" />
                <span className="font-medium">Valid Gift Code!</span>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <User className="mt-1 h-5 w-5 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-400">From</p>
                    <p className="text-white">{giftData.sender_name}</p>
                  </div>
                </div>

                {giftData.gift_message && (
                  <div className="flex items-start gap-3">
                    <MessageSquare className="mt-1 h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-400">Message</p>
                      <p className="italic text-white">&ldquo;{giftData.gift_message}&rdquo;</p>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card className="border-neutral-700 bg-neutral-800 p-6">
              <h3 className="mb-4 text-lg font-semibold text-white">Your Gift</h3>
              <div className="rounded bg-neutral-700 p-4">
                <p className="text-xl font-bold text-white">{giftData.plan.name}</p>
                {giftData.plan.description && (
                  <p className="mt-1 text-gray-400">{giftData.plan.description}</p>
                )}
                <p className="mt-2 text-2xl font-bold text-orange-400">
                  {formatPrice(giftData.plan.price.amount, giftData.plan.price.currency)}
                  <span className="text-sm font-normal text-gray-400">
                    /{giftData.plan.interval}
                  </span>
                </p>
              </div>

              {giftData.expires_at && (
                <p className="mt-4 text-sm text-yellow-400">
                  This gift expires on{" "}
                  {new Date(giftData.expires_at).toLocaleDateString()}
                </p>
              )}
            </Card>

            {!isLoaded ? (
              <div className="flex justify-center py-4">
                <RefreshCw className="h-6 w-6 animate-spin text-orange-400" />
              </div>
            ) : !user ? (
              <Card className="border-neutral-700 bg-neutral-800 p-6 text-center">
                <p className="mb-4 text-gray-400">
                  Sign in or create an account to redeem your gift
                </p>
                <Button
                  onClick={() =>
                    (window.location.href = `/sign-in?redirect_url=${encodeURIComponent(
                      `/gift/redeem?code=${code}`
                    )}`)
                  }
                  className="bg-orange-600 hover:bg-orange-700"
                >
                  Sign In to Redeem
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Card>
            ) : (
              <Button
                onClick={handleRedeem}
                disabled={redeeming}
                className="w-full bg-orange-600 py-6 text-lg hover:bg-orange-700"
              >
                {redeeming ? (
                  <>
                    <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                    Redeeming...
                  </>
                ) : (
                  <>
                    <Gift className="mr-2 h-5 w-5" />
                    Redeem Gift
                  </>
                )}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
