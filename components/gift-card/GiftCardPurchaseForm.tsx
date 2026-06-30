"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCartStore } from "@/lib/stores/cart-store";
import { Gift } from "lucide-react";

// Denominations mirror the seeded gift-card product variants.
const DENOMINATIONS = [
  { variantId: "gift-card-25", amount: 25 },
  { variantId: "gift-card-50", amount: 50 },
  { variantId: "gift-card-100", amount: 100 },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function GiftCardPurchaseForm() {
  const [amount, setAmount] = useState<number>(50);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addItem = useCartStore((s) => s.addItem);

  const handleAddToCart = () => {
    if (!recipientEmail.trim() || !EMAIL_RE.test(recipientEmail.trim())) {
      setError("Please enter a valid recipient email address");
      return;
    }
    setError(null);

    const denom = DENOMINATIONS.find((d) => d.amount === amount)!;

    addItem({
      productId: "gift-card",
      // Use the stable seeded variant id so order/admin/analytics can join on it.
      // Non-merging is handled in the cart store (gift cards are never merged).
      variantId: denom.variantId,
      name: `BeauTeas Gift Card - $${denom.amount}`,
      price: denom.amount,
      quantity: 1,
      primaryImageUrl: "/placeholder.jpg",
      giftCard: {
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim() || undefined,
        message: message.trim() || undefined,
      },
    });

    toast("Gift card added to cart", {
      description: `A $${denom.amount} gift card for ${recipientEmail.trim()} is ready at checkout.`,
      icon: "🎁",
    });

    // Reset the recipient fields for the next gift card
    setRecipientEmail("");
    setRecipientName("");
    setMessage("");
  };

  return (
    <div className="space-y-6">
      {/* Denomination */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Choose an amount</Label>
        <div className="flex flex-wrap gap-3">
          {DENOMINATIONS.map((d) => (
            <button
              key={d.variantId}
              type="button"
              onClick={() => setAmount(d.amount)}
              className={`rounded-lg border px-6 py-3 text-lg font-semibold transition ${
                amount === d.amount
                  ? "border-secondary-400 bg-surface-dark text-secondary-600"
                  : "border-border-default text-text-secondary hover:border-secondary-400"
              }`}
            >
              ${d.amount}
            </button>
          ))}
        </div>
      </div>

      {/* Recipient */}
      <div className="space-y-2">
        <Label htmlFor="recipientEmail" className="text-sm font-medium">
          Recipient email <span className="text-state-error">*</span>
        </Label>
        <Input
          id="recipientEmail"
          type="email"
          placeholder="them@example.com"
          value={recipientEmail}
          onChange={(e) => setRecipientEmail(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="recipientName" className="text-sm font-medium">
          Recipient name <span className="text-text-secondary">(optional)</span>
        </Label>
        <Input
          id="recipientName"
          type="text"
          placeholder="First name"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="message" className="text-sm font-medium">
          Personal message <span className="text-text-secondary">(optional)</span>
        </Label>
        <Textarea
          id="message"
          placeholder="Add a note to your gift…"
          rows={3}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      {error && (
        <div className="text-sm text-state-error bg-state-error-bg border border-state-error-bg rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <Button
        onClick={handleAddToCart}
        className="w-full bg-secondary-400 hover:bg-secondary-500 text-text-inverse"
        size="lg"
      >
        <Gift className="mr-2 h-4 w-4" />
        Add gift card to cart
      </Button>

      <p className="text-xs text-text-muted">
        Digital delivery: the code is emailed to your recipient after checkout. Gift
        cards never expire and any unused balance stays on the card.
      </p>
    </div>
  );
}
