/**
 * /gift-cards - Gift Card Purchase Page (Server Component)
 *
 * Lets a shopper buy a BeauTeas digital gift card for a recipient. Picking a
 * denomination + entering the recipient's details adds a gift-card line item to
 * the cart; once the order is paid, the recipient is emailed a redeemable code.
 */

import type { Metadata } from "next";
import GiftCardPurchaseForm from "@/components/gift-card/GiftCardPurchaseForm";
import { SITE_NAME } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  title: `Gift Cards | ${SITE_NAME}`,
  description:
    "Give the gift of glow. A BeauTeas digital gift card is delivered by email and redeemable at checkout on any of our organic skincare teas.",
};

export default function GiftCardsPage() {
  return (
    <main className="min-h-screen px-4 py-12 sm:px-6 lg:px-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="mb-3 text-3xl font-bold sm:text-4xl text-text-primary">BeauTeas Gift Cards</h1>
          <p className="text-text-secondary">
            Give the gift of glow. Delivered straight to their inbox, redeemable on
            any of our organic skincare teas.
          </p>
        </div>

        <div className="rounded-2xl bg-white border border-border-default p-6 text-text-primary shadow-lg sm:p-8">
          <GiftCardPurchaseForm />
        </div>
      </div>
    </main>
  );
}
