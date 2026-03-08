# Coding Conventions

**Analysis Date:** 2026-03-04

## Naming Patterns

**Files:**
- React components use PascalCase: `ProductCard.tsx`, `CartDrawer.tsx`, `ShippingForm.tsx`
- Client-only components sometimes use a `Client` suffix: `HeaderClient.tsx`, `CheckoutClient.tsx`
- Server components that delegate to a client use the base name: `Header.tsx` (server) wraps `HeaderClient.tsx`
- API route files are always `route.ts` inside directory-based routes
- Schema files use snake_case: `admin_users.ts`, `product_types.ts`, `couponInstance.ts` (inconsistent - some camelCase)
- Library modules use kebab-case or camelCase: `cart-store.ts`, `error-handler.ts`, `unified-auth.ts`
- Type files use PascalCase for MACH types: `Product.ts`, `Category.ts`, `APIResponse.ts`
- Type files use camelCase for app-specific types: `cartitem.ts`, `shipping.ts`, `billing.ts`
- Utility files use kebab-case: `image-placeholders.ts`, `performance-tracer.ts`, `review-notifications.ts`

**Functions:**
- Use camelCase for all functions: `getProductBySlug()`, `createPaymentIntent()`, `formatPrice()`
- Database query functions use verb-noun pattern: `listProducts()`, `createOrder()`, `getOrderById()`
- Validation functions use `validate` prefix: `validateProduct()`, `validateProductVariant()`
- Transform functions use `transform` or `serialize`/`deserialize` prefix: `transformProductForDB()`, `serializeProduct()`, `deserializeProduct()`
- Type guard functions use `is` prefix: `isMACHProduct()`, `isVariantAvailable()`, `isActivePromotion()`
- Boolean getter functions use `has`/`is` prefix: `hasRequiredAttributes()`, `isExpiredPromotion()`
- Error factory functions use PascalCase nouns: `AuthenticationError()`, `ValidationError()`, `ResourceNotFoundError()`

**Variables:**
- Use camelCase: `orderId`, `customerEmail`, `shippingAddress`
- Constants use UPPER_SNAKE_CASE for permission sets: `PERMISSIONS.ORDERS_READ`, `ADMIN_PERMISSIONS.PRODUCTS`
- Zustand stores use `use` prefix: `useCartStore`
- Environment variables: `NEXT_PUBLIC_` prefix for client-exposed, plain for server-only

**Types/Interfaces:**
- Use PascalCase for all interfaces and types: `CartItem`, `OrderStatus`, `AdminAuthResult`
- MACH-compliant types use `MACH` prefix: `MACHProduct`, `MACHProductVariant`, `MACHApiResponse`
- Application types omit prefix: `Product`, `Order`, `CartItem`
- Database row types use `Row` suffix: `ProductReviewRow`, `ReviewMediaRow`
- Props interfaces use `Props` suffix: `ProductCardProps`, `ButtonProps`, `ProductTableProps`
- State interfaces use `State` suffix: `CartState`, `DashboardStats`

**Database Schema:**
- Table names use snake_case: `product_reviews`, `admin_users`, `order_webhooks`
- Column names use snake_case: `customer_id`, `created_at`, `tracking_number`
- Primary key IDs use prefix pattern with nanoid: `ORD-XXXXXXXX`, `REV-XXXXXXXXXX`, `RMD-XXXXXXXXXX`

## Code Style

**Formatting:**
- No Prettier or dedicated formatter configuration detected
- ESLint is configured with `next/core-web-vitals` rules only (`.eslintrc.json`)
- No custom ESLint rules defined
- Indentation is 2 spaces
- Semicolons are used inconsistently (mostly present)
- String quotes: double quotes for imports and JSX attributes
- Trailing commas in objects and arrays

**Linting:**
- Tool: ESLint 9 with `eslint-config-next`
- Config: `.eslintrc.json` - extends `next/core-web-vitals` with no custom rules
- Run command: `npm run lint` (which runs `next lint`)

**TypeScript:**
- Strict mode enabled in `tsconfig.json`
- Target: ES2017
- Module resolution: bundler
- Path alias: `@/*` maps to project root
- Types include Cloudflare Workers types (`cloudflare-env.d.ts`)

## Import Organization

**Order:**
1. External framework imports (React, Next.js): `import { NextRequest, NextResponse } from "next/server"`
2. External library imports: `import { drizzle } from "drizzle-orm/d1"`
3. Internal absolute imports using `@/` alias: `import { getDbAsync } from "@/lib/db"`
4. Relative imports (for co-located files): `import HeaderClient from "./HeaderClient"`
5. Type-only imports: `import type { Product } from "@/lib/types"`

**Path Aliases:**
- `@/*` maps to project root (defined in `tsconfig.json`)
- All internal imports use `@/` prefix: `@/lib/utils`, `@/components/ui/button`, `@/lib/types`
- Do NOT use relative paths except for files in the same directory

**Patterns:**
- Use `import type` for type-only imports: `import type { Product, ApiResponse } from "@/lib/types"`
- Barrel files (`index.ts`) for re-exporting from directories: `lib/types/index.ts`, `lib/models/index.ts`, `lib/db/schema/index.ts`
- Named exports preferred over default exports for library code
- Default exports used for React page/layout components and top-level components

## Component Patterns

**Server vs Client Components:**
- Server Components are the default; use `"use client"` directive only when needed
- Server components handle data fetching and pass props to client components
- Pattern: Server component fetches data, client component handles interactivity
- Example: `Header.tsx` (server) fetches categories, passes to `HeaderClient.tsx` (client)
- Page components (`page.tsx`) are server components by default; named feature components are client
- Admin pages are all client components (`"use client"`) since they need interactivity

**Component Structure:**
```tsx
/**
 * === Component Name ===
 *
 * Description block with features, usage, etc.
 */

"use client"; // Only if needed

import { ... } from "...";    // Framework
import { ... } from "@/...";  // Internal

interface ComponentProps {
  prop: Type;
}

export default function Component({ prop }: ComponentProps) {
  // Hooks first
  const [state, setState] = useState(initialValue);

  // Derived values
  const derived = compute(prop);

  // Event handlers
  const handleAction = useCallback(async () => {
    // ...
  }, [deps]);

  // Effects
  useEffect(() => {
    // ...
  }, [deps]);

  // Loading/error states
  if (loading) return <LoadingUI />;

  // Render
  return <div>...</div>;
}
```

**UI Components:**
- Use shadcn/ui components from `@/components/ui/` (New York style, Radix primitives)
- Use `cn()` from `@/lib/utils` for class merging: `cn("base-class", conditional && "conditional-class", className)`
- Use `class-variance-authority` (cva) for component variants
- Icons from `lucide-react`
- Toast notifications via `sonner`

**Styling Pattern:**
- Tailwind CSS classes directly in JSX
- Use semantic color tokens from brand config: `bg-surface-dark`, `text-text-primary`, `border-border-default`
- Dark theme hardcoded in most components using neutral-800/900 backgrounds
- Mobile-first responsive: `text-sm sm:text-base lg:text-lg`

## API Route Patterns

**Standard Response Format (MACH-compliant):**
```typescript
// Success - list
{
  data: items,
  meta: {
    total: number,
    limit: number,
    offset: number,
    schema: "mach:entity_name"
  },
  links: {
    self: string,
    first: string,
    next?: string,
    prev?: string,
    last: string
  }
}

// Success - single item
{
  data: item,
  meta: {
    schema: "mach:entity_name"
  }
}

// Error
{
  error: "Human-readable error message",
  details?: string[],   // Validation errors
  message?: string       // Additional context
}
```

**Route Handler Pattern:**
```typescript
export async function GET(request: NextRequest) {
  try {
    // 1. Parse query params
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);

    // 2. Auth check (if needed)
    const authResult = await authenticateRequest(request, PERMISSIONS.SCOPE);

    // 3. Database query
    const db = await getDbAsync();
    const results = await db.select().from(table);

    // 4. Return MACH-compliant response
    return NextResponse.json({ data: results, meta: { schema: "mach:type" } });

  } catch (error) {
    console.error('API Name error:', error);
    return NextResponse.json(
      { error: 'Failed to perform operation' },
      { status: 500 }
    );
  }
}
```

**HTTP Status Codes:**
- 200: Successful GET/PUT
- 201: Successful POST (creation)
- 400: Validation errors
- 401: Authentication required
- 403: Forbidden (insufficient permissions)
- 404: Resource not found
- 500: Internal server error

## Error Handling

**API Routes:**
- Wrap entire handler in try/catch
- Log errors with `console.error('Context:', error)`
- Return JSON error responses with appropriate HTTP status
- Check `error instanceof Error` for typed error messages in catch blocks
- Non-critical failures (like email sending) are caught separately and logged without failing the main operation

**MCP Layer:**
- Custom `MCPServerError` class with structured error codes in `lib/mcp/error-handler.ts`
- Error factory functions for common errors: `AuthenticationError()`, `ValidationError()`, `ResourceNotFoundError()`
- Error responses include `retryable` flag and `suggestion` field for AI agents

**Client Components:**
- Use try/catch in async operations
- Set error state and display in UI
- Graceful degradation: show fallback content on error
- `console.error()` for logging

**General:**
- No centralized error boundary component detected
- No global error logging service (uses `console.error` throughout)
- Environment variable validation at module load time (warnings, not throws) - see `lib/stripe.ts`

## Logging

**Framework:** `console` (no dedicated logging library)

**Patterns:**
- `console.error('Context:', error)` for errors in catch blocks
- `console.log('Descriptive message:', data)` for informational logging
- `console.warn('Warning message')` for non-critical issues
- Development bypass logging uses emoji prefixes: `console.log("WARNING: ...")`
- No structured logging; all messages are free-form strings

## Comments

**When to Comment:**
- Every file has a large JSDoc-style header block describing the module's purpose, features, technical implementation, and usage
- These header blocks are extensive (20-50+ lines) and follow a consistent `=== Section Name ===` format
- Functions have JSDoc comments with `@param` and `@returns` tags
- Inline comments explain "why" for non-obvious logic
- `// TODO:` comments mark planned work
- Deprecated code is marked with `// deprecated - use X instead`

**File Header Pattern:**
```typescript
/**
 * === Module Name ===
 *
 * Description of the module.
 *
 * === Features ===
 * - **Feature 1**: Description
 * - **Feature 2**: Description
 *
 * === Technical Implementation ===
 * - **Detail 1**: Description
 *
 * === Usage ===
 * ```typescript
 * // Code example
 * ```
 */
```

**JSDoc on Functions:**
```typescript
/**
 * Brief description of what the function does
 *
 * @param paramName - Description of parameter
 * @returns Description of return value
 */
```

## Function Design

**Size:** No strict limits; some files are large (400+ lines for API route handlers). Admin page components can be 600+ lines.

**Parameters:** Use destructured props for React components. Use individual parameters for utility functions. Use option objects for functions with many optional params.

**Return Values:**
- Async functions return Promises
- Database queries return arrays or single items (with `[0]` pattern for single results)
- API functions return `NextResponse.json()`
- Validation functions return boolean type guards

## Module Design

**Exports:**
- Default exports for React page/layout components and top-level display components
- Named exports for utility functions, types, constants, and library code
- Re-exports via barrel files (`index.ts`) at directory level

**Barrel Files:**
- `lib/types/index.ts` - Re-exports all types
- `lib/models/index.ts` - Re-exports all model functions
- `lib/db/schema/index.ts` - Re-exports all schema definitions (with selective exports to avoid conflicts)
- `lib/auth/index.ts` - Re-exports auth functions and types
- `lib/brand/index.ts` - Re-exports brand config and provider

**State Management:**
- Zustand for client-side state: `lib/stores/cart-store.ts`, `lib/stores/chat-store.ts`
- Zustand stores use `persist` middleware with `localStorage` and `skipHydration: true`
- Hydration handled via custom hook: `hooks/useCartPersistence.ts`
- React `cache()` for server-side request-level memoization: `lib/db.ts`
- `unstable_cache` from Next.js for cross-request caching with revalidation

**Database Access:**
- Use `getDb()` for server components (synchronous Cloudflare context)
- Use `getDbAsync()` for API routes (asynchronous Cloudflare context)
- All queries use Drizzle ORM query builder syntax
- JSON fields stored as text and parsed/serialized in model layer

---

*Convention analysis: 2026-03-04*
