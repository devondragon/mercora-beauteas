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
    // Unique variantId so each gift card is its own cart line (cards aren't merged).
    const uniqueSuffix =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    addItem({
      productId: "gift-card",
      variantId: `${denom.variantId}::${uniqueSuffix}`,
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
                  ? "border-[#c4a87c] bg-[#fdf8f6] text-[#c4a87c]"
                  : "border-gray-200 text-gray-700 hover:border-[#c4a87c]"
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
          Recipient email <span className="text-red-500">*</span>
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
          Recipient name <span className="text-gray-400">(optional)</span>
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
          Personal message <span className="text-gray-400">(optional)</span>
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
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <Button
        onClick={handleAddToCart}
        className="w-full bg-[#c4a87c] hover:bg-[#b3966b] text-white"
        size="lg"
      >
        <Gift className="mr-2 h-4 w-4" />
        Add gift card to cart
      </Button>

      <p className="text-xs text-gray-500">
        Digital delivery: the code is emailed to your recipient after checkout. Gift
        cards never expire and any unused balance stays on the card.
      </p>
    </div>
  );
}
