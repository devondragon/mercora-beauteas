"use client";

import type { EnrichedSubscription } from "./page";

interface SubscriptionsClientProps {
  subscriptions: EnrichedSubscription[];
}

export default function SubscriptionsClient({ subscriptions }: SubscriptionsClientProps) {
  return <div>Loading...</div>;
}
