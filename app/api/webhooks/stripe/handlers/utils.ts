import { getStripeForWorkers } from '@/lib/stripe';
import { resolveLocalizedField } from '@/lib/seo/metadata';
import { getDbAsync } from '@/lib/db';
import { products } from '@/lib/db/schema/products';
import { eq } from 'drizzle-orm';

/**
 * Retrieve Stripe customer details for email sending.
 * Returns email and name, falling back to empty string if not available.
 */
export async function getCustomerDetails(customerId: string): Promise<{ email: string; name: string }> {
  try {
    const stripe = getStripeForWorkers();
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return { email: '', name: '' };
    }
    return {
      email: customer.email || '',
      name: customer.name || '',
    };
  } catch (error) {
    console.error('[webhook] Failed to retrieve customer details:', error);
    return { email: '', name: '' };
  }
}

/**
 * Resolve a human-readable product name from the products table.
 * Falls back to 'Your Subscription' on any error.
 */
export async function getProductName(productId: string): Promise<string> {
  try {
    const db = await getDbAsync();
    const [product] = await db
      .select({ name: products.name })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    return product ? resolveLocalizedField(product.name, 'Your Subscription') : 'Your Subscription';
  } catch (error) {
    console.error('[webhook] Failed to resolve product name:', error);
    return 'Your Subscription';
  }
}
