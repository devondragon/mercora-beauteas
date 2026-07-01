/**
 * === Stripe Elements Provider ===
 *
 * Wrapper component that provides Stripe Elements context to child components.
 * Handles Stripe initialization, theming, and configuration for payment forms.
 *
 * === Features ===
 * - **Stripe Elements**: Secure payment form components
 * - **Theme Configuration**: Consistent styling with app design
 * - **Error Handling**: Graceful fallbacks for Stripe loading issues
 * - **Type Safety**: Full TypeScript support
 * - **Performance**: Lazy loading and caching
 *
 * === Usage ===
 * ```tsx
 * <StripeProvider>
 *   <PaymentForm />
 * </StripeProvider>
 * ```
 */

"use client";

import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@/lib/stripe';
import type { ReactNode } from 'react';
import type { StripeElementsOptions } from '@stripe/stripe-js';

interface StripeProviderProps {
  children: ReactNode;
  clientSecret?: string;
  options?: StripeElementsOptions;
}

// Load Stripe outside of component to avoid recreating on every render
const stripePromise = loadStripe();

/**
 * Stripe Elements provider with custom theme and configuration
 */
export default function StripeProvider({ 
  children, 
  clientSecret,
  options = {}
}: StripeProviderProps) {
  // Return early if no clientSecret provided
  if (!clientSecret) {
    return <div>{children}</div>;
  }

  // Configure Elements options with theme
  const elementsOptions: StripeElementsOptions = {
    clientSecret,
    appearance: {
      theme: 'stripe',
      // NOTE: Stripe Elements cannot read Tailwind/CSS custom properties, so
      // these are deliberately inline hex values mirroring the BeauTeas brand
      // tokens (lib/brand.config.ts): primary-500 #cf8577, text-primary #222222,
      // state.error #a1453d.
      variables: {
        colorPrimary: '#cf8577', // BeauTeas primary-500 (terracotta)
        colorBackground: '#ffffff',
        colorText: '#222222', // BeauTeas text-primary (charcoal)
        colorDanger: '#a1453d', // BeauTeas state.error
        fontFamily: 'system-ui, -apple-system, sans-serif',
        spacingUnit: '4px',
        borderRadius: '8px',
        ...(options.appearance?.variables || {}),
      },
      rules: {
        '.Input': {
          border: '1px solid #e8d5cf', // BeauTeas border.DEFAULT
          borderRadius: '8px',
          padding: '12px',
          fontSize: '16px', // 16px prevents zoom on iOS
          minHeight: '44px', // Touch-friendly minimum height
          transition: 'border-color 0.15s ease-in-out',
          width: '100%',
          boxSizing: 'border-box',
          '-webkit-appearance': 'none', // Remove iOS styling
        },
        '.Input:focus': {
          borderColor: '#cf8577',
          boxShadow: '0 0 0 2px rgba(207, 133, 119, 0.2)',
          outline: 'none',
        },
        '.Input--invalid': {
          borderColor: '#a1453d',
        },
        '.Label': {
          fontSize: '14px',
          fontWeight: '500',
          marginBottom: '8px',
          color: '#555555', // BeauTeas text.secondary
          display: 'block',
          width: '100%',
        },
        '.Tab': {
          minHeight: '44px',
          padding: '12px 16px',
          fontSize: '16px',
          width: '100%',
          boxSizing: 'border-box',
        },
        '.Tab--selected': {
          borderColor: '#cf8577',
        },
        '.TabIcon': {
          height: '20px',
          width: '20px',
        },
        '.TabList': {
          width: '100%',
        },
        '.TabContent': {
          width: '100%',
          marginTop: '16px',
        },
        // Note: Stripe doesn't support media queries, mobile styles handled at component level
        ...(options.appearance?.rules || {}),
      },
    },
    // Only spread appearance-related options to avoid conflicts with clientSecret mode
    ...(options.fonts && { fonts: options.fonts }),
    ...(options.locale && { locale: options.locale }),
  };

  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
      {children}
    </Elements>
  );
}