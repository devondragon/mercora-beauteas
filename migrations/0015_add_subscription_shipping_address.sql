-- Migration: 0015_add_subscription_shipping_address.sql
-- Description: Persist the shipping address collected at subscription checkout on
--              the subscription row (BMC-171). Subscription renewals create real
--              fulfillable orders in the admin from a webhook, so each order needs
--              a shipping address — but the address was collected client-side and
--              silently dropped server-side, and lived nowhere in D1 or Stripe.
--              This adds a nullable JSON column (MACH Address shape) written when
--              the subscription row is created from `customer.subscription.created`
--              (sourced from the Stripe subscription's `shipping_address` metadata)
--              and read by both the initial and renewal order-creation paths.
--
--              Nullable with no default: existing rows stay NULL; their orders fall
--              back to no address (merchant reconciles manually) rather than block.

ALTER TABLE customer_subscriptions ADD COLUMN shipping_address TEXT;
