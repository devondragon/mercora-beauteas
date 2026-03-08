# Testing Patterns

**Analysis Date:** 2026-03-04

## Test Framework

**Runner:**
- No test framework is installed or configured
- No test runner (Jest, Vitest, Playwright, Cypress, etc.) detected in `package.json` dependencies
- No test configuration files found (no `jest.config.*`, `vitest.config.*`, `playwright.config.*`)

**Assertion Library:**
- None installed

**Run Commands:**
```bash
# No test scripts defined in package.json
# Only lint is available:
npm run lint              # Runs next lint (ESLint only)
```

## Test File Organization

**Location:**
- No test files exist anywhere in the codebase
- No `*.test.*`, `*.spec.*`, or `__tests__/` directories found

**Current State:**
- The project has ZERO automated tests
- No unit tests, integration tests, or end-to-end tests
- Linting via `next lint` is the only code quality check

## Recommendations for Adding Tests

Given the codebase architecture (Next.js 15 App Router, Cloudflare D1, Drizzle ORM, Zustand), the recommended testing setup would be:

### Suggested Framework Setup

**Unit/Integration Tests:**
- Use Vitest (better Next.js App Router compatibility than Jest)
- Install: `vitest`, `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/jest-dom`
- Config file: `vitest.config.ts` at project root

**E2E Tests:**
- Use Playwright for end-to-end browser tests
- Config file: `playwright.config.ts` at project root

### Suggested Test File Organization

**Pattern:** Co-located test files alongside source

```
lib/
  utils.ts
  utils.test.ts           # Unit test for utils
  stores/
    cart-store.ts
    cart-store.test.ts     # Unit test for store
  models/
    mach/
      products.ts
      products.test.ts     # Unit test for model layer
components/
  ProductCard.tsx
  ProductCard.test.tsx     # Component test
app/
  api/
    products/
      route.ts
      route.test.ts        # API route test
tests/
  e2e/                     # E2E tests in separate directory
    checkout.spec.ts
    admin.spec.ts
```

**Naming Convention (recommended):**
- Unit/component tests: `{filename}.test.{ts,tsx}`
- E2E tests: `{feature}.spec.ts`

### Priority Testing Areas

**High Priority (business-critical logic):**

1. **Cart Store** (`lib/stores/cart-store.ts`)
   - Add/remove/update items
   - Discount application and calculation
   - Total calculations with tax, shipping, discounts
   - Persistence and hydration

2. **Order Creation** (`app/api/orders/route.ts`)
   - Validation of required fields
   - Order ID generation
   - Customer record creation/lookup
   - Response format compliance

3. **Product Data Serialization** (`lib/db/schema/products.ts`)
   - `serializeProduct()` / `deserializeProduct()` round-trip
   - `parseMaybeJson()` edge cases
   - Variant price and inventory parsing

4. **Payment Processing** (`lib/stripe.ts`)
   - `createPaymentIntent()` with both Stripe SDK and CloudflareStripe
   - `formatAmountForStripe()` / `formatAmountFromStripe()` conversions
   - Webhook payload verification

5. **Auth Middleware** (`lib/auth/admin-middleware.ts`)
   - Admin permission checking
   - Dev mode bypass behavior
   - API token authentication

**Medium Priority:**

6. **Utility Functions** (`lib/utils.ts`)
   - `cn()` class merging
   - `formatPrice()` output
   - `debounce()` behavior

7. **Email Templates** (`lib/utils/email.ts`)
   - `sendOrderConfirmationEmail()` data transformation
   - `sendOrderStatusUpdateEmail()` status mapping

8. **MCP Error Handler** (`lib/mcp/error-handler.ts`)
   - Error factory functions produce correct codes
   - `createErrorResponse()` structure
   - `createHttpErrorResponse()` status mapping

### Suggested Test Patterns

**Unit Test (Vitest):**
```typescript
// lib/utils.test.ts
import { describe, it, expect } from 'vitest';
import { formatPrice, cn, debounce } from './utils';

describe('formatPrice', () => {
  it('formats cents to dollar string', () => {
    expect(formatPrice(1999)).toBe('$19.99');
  });

  it('handles zero', () => {
    expect(formatPrice(0)).toBe('$0.00');
  });
});

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('bg-red-500', 'text-white')).toBe('bg-red-500 text-white');
  });

  it('resolves Tailwind conflicts', () => {
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toBe('base visible');
  });
});
```

**Store Test (Vitest + Zustand):**
```typescript
// lib/stores/cart-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from './cart-store';

describe('CartStore', () => {
  beforeEach(() => {
    useCartStore.setState({
      items: [],
      appliedDiscounts: [],
      totalDiscount: 0,
    });
  });

  it('adds item to cart', () => {
    useCartStore.getState().addItem({
      variantId: 'v1',
      productId: 'p1',
      name: 'Test Tea',
      price: 1999,
      quantity: 1,
    });

    expect(useCartStore.getState().items).toHaveLength(1);
  });

  it('merges quantities for duplicate items', () => {
    const item = { variantId: 'v1', productId: 'p1', name: 'Tea', price: 1999, quantity: 1 };
    useCartStore.getState().addItem(item);
    useCartStore.getState().addItem(item);

    expect(useCartStore.getState().items[0].quantity).toBe(2);
  });
});
```

**API Route Test (Vitest):**
```typescript
// app/api/products/route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';
import { NextRequest } from 'next/server';

// Mock the database layer
vi.mock('@/lib/models/mach/products', () => ({
  listProducts: vi.fn().mockResolvedValue([
    { id: 'p1', name: 'Test Product', status: 'active' }
  ]),
  getProductsByCategory: vi.fn().mockResolvedValue([]),
}));

describe('GET /api/products', () => {
  it('returns MACH-compliant response', async () => {
    const request = new NextRequest('http://localhost/api/products');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data).toBeDefined();
    expect(json.meta.schema).toBe('mach:product');
    expect(json.links.self).toBeDefined();
  });
});
```

**Mocking Guidance:**

**What to Mock:**
- Database calls (`getDb()`, `getDbAsync()`) - Cloudflare D1 is not available in test env
- External APIs (Stripe, Resend, Clerk) - avoid hitting real services
- Cloudflare context (`getCloudflareContext()`)
- `fetch()` calls in client components

**What NOT to Mock:**
- Pure utility functions (`formatPrice`, `cn`, `serializeProduct`)
- Zustand store logic (test the actual store)
- Type guards and validation functions
- Data transformation functions

### Coverage

**Requirements:** None currently enforced

**Recommended Targets:**
- `lib/utils/` - 90%+ (pure functions, easy to test)
- `lib/stores/` - 85%+ (critical business logic)
- `lib/models/` - 75%+ (data access layer)
- `app/api/` - 70%+ (API route handlers)
- `components/` - 50%+ (focus on complex interactive components)

### Suggested package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test"
  }
}
```

### Vitest Configuration (Suggested)

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

## Current Quality Checks

The only automated quality check is ESLint:

```bash
npm run lint    # Runs: next lint
```

**ESLint Config** (`.eslintrc.json`):
```json
{
  "$schema": "https://json.schemastore.org/eslintrc",
  "extends": ["next/core-web-vitals"],
  "rules": {}
}
```

This provides:
- React hooks rules
- Next.js best practices (Image, Link, etc.)
- Import/export checks
- Accessibility basics (jsx-a11y)

**No Type Checking Script:**
- TypeScript strict mode is enabled but `tsc --noEmit` is not in `package.json` scripts
- Type checking only happens during `next build`

---

*Testing analysis: 2026-03-04*
