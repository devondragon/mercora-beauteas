# Phase 4: Data Migration - Research

**Researched:** 2026-03-06
**Domain:** Shopify-to-Mercora data migration (ETL scripts, Cloudflare D1/R2, Clerk Backend API)
**Confidence:** HIGH

## Summary

Phase 4 is a scripts-only phase that migrates all BeauTeas data from Shopify to Mercora's Cloudflare D1 database, R2 storage, and Clerk authentication. The data scale is small (~30 products, <1K customers, a few hundred orders) so sequential processing with simple scripts is appropriate. No batching, parallelism, or streaming infrastructure is needed.

The scripts run locally via `tsx` (already a dev dependency) and interact with D1 via `wrangler d1 execute` for SQL and the Cloudflare R2 S3-compatible API for image uploads. Customer import uses the Clerk Backend API's `createUser()` with `skipPasswordRequirement: true`. Judge.me reviews are imported from a CSV export with standard columns (title, body, rating, reviewer_name, reviewer_email, product_handle, review_date, reply, picture_urls).

**Primary recommendation:** Build modular ETL scripts in `scripts/shopify-migration/` with both Shopify Admin REST API and CSV/JSON file extractors per entity, using `wrangler d1 execute --file` for SQL loading and `@aws-sdk/client-s3` for R2 image uploads. Run entities in dependency order: categories, products+images, customers, orders, reviews, pages, redirect-map, then validation.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Modular ETL structure: separate extractor, transformer, and loader per entity, plus a top-level `migrate-all.ts` orchestrator that runs them in dependency order
- Each entity module (migrate-products.ts, migrate-customers.ts, etc.) can run independently for debugging, or the orchestrator runs all sequentially
- Pluggable extractor layer: each entity has a Shopify Admin API extractor AND a file-based extractor (CSV/JSON), both producing the same intermediate format for transformers
- Scripts run locally in Node.js (via tsx), NOT as Cloudflare Workers -- full Node.js APIs, no 30-second CPU limit, filesystem access for export files
- D1 access via `wrangler d1 execute`; R2 access via Cloudflare S3-compatible API
- All scripts live in `scripts/shopify-migration/`
- Both Shopify Admin API access and export files are available -- scripts support either extraction path
- Clerk Backend API used directly for customer import (createUser with skip_password_requirement), not bulk import files -- appropriate for <1K customers
- Judge.me reviews: script accepts standard CSV or JSON format regardless of whether data comes from Judge.me API or dashboard export (format TBD by user)
- Download product images from Shopify CDN URLs during migration and upload to R2
- Category images also migrated from Shopify collections to R2 categories/ folder
- Retry 3 times with backoff on failed image downloads, then skip and log the failure -- continue migrating everything else
- Store redirect mappings in a D1 table (not static JSON file) -- more flexible, can be updated without redeployment
- Redirect map generated from migrated data: old Shopify URL to new Mercora URL for products, collections, and pages
- Phase 1's next.config.ts redirect stubs will be updated to read from D1 dynamically via middleware
- Record count comparison per entity (source vs destination) plus spot-check samples for field accuracy
- Validation runs automatically at the end of the migration orchestrator (not a separate script)
- R2 image validation: verify files exist in R2 listing, no HTTP accessibility check needed
- Generate a summary report showing counts, mismatches, and any skipped/failed records

### Claude's Discretion
- Exact ETL intermediate data formats
- Dependency ordering between entity migrations
- Spot-check sample size and which fields to verify
- ID mapping strategy (Shopify IDs to Mercora nanoid IDs)
- How to handle Shopify data fields that don't map to Mercora schema (drop vs store in extensions)
- Handling the NOT NULL order_id constraint on product_reviews for imported reviews (synthetic reference vs schema change)
- Image filename convention (original Shopify names vs Mercora pattern)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MIGR-01 | Migration scripts in `scripts/shopify-migration/` with ETL architecture | Script architecture patterns, tsx runner, wrangler CLI commands documented |
| MIGR-02 | Products, variants, and product images migrated from Shopify to D1 and R2 | Shopify product CSV/API fields mapped to Mercora schema; R2 S3 API for image upload |
| MIGR-03 | Shopify collections mapped to Mercora categories | Shopify custom_collections/smart_collections API; Mercora categories schema documented |
| MIGR-04 | Customer emails imported to Clerk with `skip_password_requirement` | Clerk createUser() API verified with skipPasswordRequirement param |
| MIGR-05 | Historical orders imported as read-only records with preserved dates and status | Orders schema documented; status mapping from Shopify to Mercora defined |
| MIGR-06 | Judge.me reviews imported to `product_reviews` with product rating recalculation | Judge.me CSV format verified; order_id constraint solution documented; ratings.ts helper available |
| MIGR-07 | CMS pages imported from Shopify | Pages schema documented; Shopify pages API/export available |
| MIGR-08 | Redirect map generated from migrated data to complete SEO-07 redirects | D1 redirect table design; middleware integration pattern for dynamic lookups |
| MIGR-09 | Post-migration validation with record count comparison per table and spot checks | Validation architecture documented with per-entity count comparison and sampling strategy |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tsx | ^4.20.3 | Run TypeScript scripts locally | Already in devDependencies; runs .ts files with zero config |
| wrangler | ^4.40.2 | D1 database access via CLI | Already in devDependencies; `wrangler d1 execute` for SQL execution |
| @aws-sdk/client-s3 | ^3.x (latest) | R2 image uploads via S3-compatible API | Official Cloudflare-recommended approach for external R2 access |
| nanoid | ^5.1.6 | Generate prefixed IDs for migrated records | Already in dependencies; matches existing ID patterns (PRD-, ORD-, REV-) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| csv-parse | ^5.x | Parse Shopify/Judge.me CSV exports | When extracting from CSV export files |
| node:fs/promises | built-in | Read export files, write reports | File-based extraction path |
| node:path | built-in | Path resolution for scripts | Script file handling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @aws-sdk/client-s3 | wrangler r2 object put | CLI per-file is slower for batch; SDK allows programmatic control and retry |
| csv-parse | Manual CSV splitting | csv-parse handles edge cases (quoted fields, commas in values) correctly |
| Direct fetch to Shopify API | CSV export files | API gives structured JSON but requires auth setup; CSV is simpler for one-time migration |

**Installation:**
```bash
npm install --save-dev @aws-sdk/client-s3 csv-parse
```

Note: `tsx`, `wrangler`, and `nanoid` are already installed.

## Architecture Patterns

### Recommended Project Structure
```
scripts/shopify-migration/
  migrate-all.ts              # Orchestrator: runs all migrations in order
  lib/
    types.ts                   # Shared intermediate data formats
    id-map.ts                  # Shopify ID -> Mercora ID mapping registry
    config.ts                  # Environment config (API keys, DB name, R2 creds)
    wrangler-exec.ts           # Helper: run wrangler d1 execute with SQL
    r2-client.ts               # S3Client setup for R2 uploads
    shopify-api.ts             # Shopify Admin REST API client (if API path used)
    csv-reader.ts              # CSV/JSON file reader utility
    logger.ts                  # Console logging with levels + migration report
  extractors/
    shopify-api/               # API-based extractors
      products.ts
      collections.ts
      customers.ts
      orders.ts
      pages.ts
    file-based/                # CSV/JSON file extractors
      products.ts
      collections.ts
      customers.ts
      orders.ts
      reviews.ts
      pages.ts
  transformers/
    products.ts                # Shopify product -> Mercora product + variants
    categories.ts              # Shopify collection -> Mercora category
    customers.ts               # Shopify customer -> Clerk createUser params
    orders.ts                  # Shopify order -> Mercora order
    reviews.ts                 # Judge.me review -> Mercora product_review
    pages.ts                   # Shopify page -> Mercora CMS page
    redirects.ts               # Generate redirect map from migrated data
  loaders/
    d1-loader.ts               # Generate SQL and execute via wrangler
    r2-loader.ts               # Upload images to R2 via S3 API
    clerk-loader.ts            # Create users in Clerk via Backend API
  validators/
    validate.ts                # Count comparison + spot checks
```

### Pattern 1: ETL Module Interface
**What:** Every entity module follows the same Extract-Transform-Load contract.
**When to use:** Every migration entity.
```typescript
// scripts/shopify-migration/lib/types.ts

// Each extractor produces this shape
interface ExtractResult<T> {
  records: T[];
  source: 'api' | 'file';
  extractedAt: string;
}

// Each transformer produces this shape
interface TransformResult<TSource, TTarget> {
  records: TTarget[];
  idMap: Map<string, string>;  // shopifyId -> mercoraId
  skipped: Array<{ record: TSource; reason: string }>;
  warnings: string[];
}

// Each loader returns this shape
interface LoadResult {
  entity: string;
  inserted: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}
```

### Pattern 2: ID Mapping Registry
**What:** Central Map that tracks Shopify ID to Mercora nanoid mapping, persisted to JSON file between runs.
**When to use:** Every entity needs to cross-reference IDs (products reference categories, orders reference customers/products, reviews reference products/orders).
```typescript
// scripts/shopify-migration/lib/id-map.ts
class IdMap {
  private maps: Record<string, Map<string, string>> = {};

  register(entity: string, shopifyId: string, mercoraId: string): void {
    if (!this.maps[entity]) this.maps[entity] = new Map();
    this.maps[entity].set(shopifyId, mercoraId);
  }

  resolve(entity: string, shopifyId: string): string | undefined {
    return this.maps[entity]?.get(shopifyId);
  }

  // Persist to JSON for debugging and re-runs
  save(path: string): void { /* write to file */ }
  load(path: string): void { /* read from file */ }
}
```

### Pattern 3: Wrangler D1 SQL Execution
**What:** Generate SQL INSERT statements and execute via `wrangler d1 execute --file`.
**When to use:** All D1 data loading.
```typescript
// scripts/shopify-migration/loaders/d1-loader.ts
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';

function executeSql(sql: string, dbName: string, env: string = 'dev'): void {
  const tmpFile = `/tmp/migration-${Date.now()}.sql`;
  writeFileSync(tmpFile, sql);
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', dbName, '--env', env, `--file=${tmpFile}`],
    { stdio: 'inherit' }
  );
}

// Generate parameterized INSERT statements
function generateInsertSql(table: string, records: Record<string, any>[]): string {
  if (records.length === 0) return '';
  const columns = Object.keys(records[0]);
  const values = records.map(r =>
    `(${columns.map(c => escapeSqlValue(r[c])).join(', ')})`
  ).join(',\n');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`;
}
```

### Pattern 4: R2 Image Upload via S3 API
**What:** Use @aws-sdk/client-s3 with R2 endpoint for image uploads from local scripts.
**When to use:** Product and category image migration.
```typescript
// Source: https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/
// scripts/shopify-migration/lib/r2-client.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function uploadToR2(key: string, body: Buffer, contentType: string): Promise<void> {
  await r2Client.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}
```

### Pattern 5: Image Download with Retry
**What:** Download images from Shopify CDN with exponential backoff retry.
**When to use:** Product and category image downloads.
```typescript
async function downloadWithRetry(
  url: string,
  maxRetries: number = 3
): Promise<Buffer | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`Failed after ${maxRetries} attempts: ${url}`, error);
        return null; // Skip and log
      }
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}
```

### Anti-Patterns to Avoid
- **Importing Drizzle ORM directly in migration scripts:** The existing `lib/db.ts` uses `getCloudflareContext()` which only works inside Cloudflare Workers runtime. Migration scripts run in Node.js via tsx, so they must use `wrangler d1 execute` CLI instead.
- **Using R2Bucket binding from scripts:** R2 bucket bindings (`env.MEDIA`) only work inside Workers. Use the S3-compatible API with API tokens for external access.
- **Single monolithic migration script:** Makes debugging impossible. Each entity must be independently runnable.
- **Hardcoding IDs:** Shopify IDs are numeric; Mercora uses prefixed nanoids (PRD-XXXXXXXX). Always generate new IDs and maintain a mapping.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV parsing | Custom string splitting | `csv-parse` | Handles quoted fields, embedded commas, multiline values |
| SQL value escaping | Manual string replacement | Proper escaping function with type-aware quoting | SQL injection in migration data, apostrophes in product names |
| Image content type detection | Extension guessing | `getContentTypeFromFilename()` from existing `lib/utils/r2.ts` | Already handles all common types |
| Nanoid generation | Custom random strings | `nanoid` with existing prefix patterns | Matches existing PRD-, ORD-, REV- patterns exactly |
| Exponential backoff | Custom sleep math | Simple `Math.pow(2, attempt) * 1000` pattern | Trivial enough to inline, but must not forget |

**Key insight:** The migration scripts cannot reuse the app's Drizzle ORM layer (it requires Cloudflare Workers runtime). All D1 interaction must go through wrangler CLI. However, the schema definitions in `lib/db/schema/` are the authoritative reference for table structures and field formats.

## Common Pitfalls

### Pitfall 1: JSON Serialization Mismatch
**What goes wrong:** Mercora stores complex fields as JSON strings in SQLite text columns. Inserting a raw object instead of `JSON.stringify()` produces `[object Object]` in the database.
**Why it happens:** The existing `serializeProduct()`, `serializeCategory()`, `serializeCustomer()` functions handle this, but migration scripts write raw SQL, not Drizzle inserts.
**How to avoid:** Every JSON field (options, media, seo, rating, extensions, addresses, etc.) must be `JSON.stringify()`'d before SQL generation. Reference the `serialize*()` functions in schema files for which fields need serialization.
**Warning signs:** Products display as "[object Object]" on the storefront.

### Pitfall 2: Shopify Price Format vs Mercora Price Format
**What goes wrong:** Shopify stores prices as decimal strings ("14.99") or cents in API. Mercora stores prices as `{"amount": 1499, "currency": "USD"}` JSON objects (cents).
**Why it happens:** Different price representation conventions.
**How to avoid:** Transform all Shopify prices to Mercora Money objects: `{ amount: Math.round(parseFloat(shopifyPrice) * 100), currency: "USD" }`.
**Warning signs:** Prices showing as $0.14 instead of $14.99 (or $1499.00).

### Pitfall 3: NOT NULL order_id on product_reviews
**What goes wrong:** The `product_reviews` table has `order_id: text('order_id').notNull()`. Judge.me reviews being imported have no corresponding Mercora order.
**Why it happens:** Schema was designed for native reviews submitted after purchase, not imported reviews.
**How to avoid:** Use a synthetic order reference like `IMPORTED` as the order_id for migrated reviews. This avoids schema changes while keeping the data clean. The `customer_id` field is also NOT NULL -- use `IMPORTED` or the mapped Clerk/Mercora customer ID if the reviewer email matches a migrated customer.
**Warning signs:** Migration fails with "NOT NULL constraint failed: product_reviews.order_id".

### Pitfall 4: Shopify Product Handles vs Mercora Slugs
**What goes wrong:** Shopify uses "handles" (e.g., `clearly-calendula-morning`). Mercora uses "slugs". They serve the same purpose but the redirect map must account for the URL pattern change (`/products/handle` -> `/product/slug`).
**Why it happens:** Different URL conventions between platforms.
**How to avoid:** Preserve Shopify handles as Mercora slugs (they're already URL-safe). The redirect pattern change is `/products/` -> `/product/` (plural to singular), which Phase 1 already handles in next.config.ts. The redirect map needs to handle cases where slugs change.
**Warning signs:** 404s after migration for products that had slug differences.

### Pitfall 5: Category Name Localization Format
**What goes wrong:** Mercora categories store `name` as JSON for localization: `'{"en": "Featured"}'`. Inserting a plain string breaks deserialization.
**Why it happens:** The MACH Alliance schema supports localized names, even though BeauTeas only uses English.
**How to avoid:** Wrap all category names in the localization format: `JSON.stringify({"en": shopifyCollectionTitle})`. Same for description and slug fields.
**Warning signs:** Category names display as raw JSON or throw parse errors.

### Pitfall 6: Wrangler D1 Execute SQL Size Limits
**What goes wrong:** Very large SQL files may hit wrangler CLI limits or D1 transaction limits.
**Why it happens:** D1 has a 100KB SQL statement size limit per query.
**How to avoid:** Split large INSERT batches into chunks (50-100 records per statement). For ~30 products and a few hundred orders, this is unlikely to be an issue, but the script should chunk just in case.
**Warning signs:** Wrangler errors mentioning statement size or transaction limits.

### Pitfall 7: R2 Credential Management
**What goes wrong:** R2 S3-compatible API requires separate API tokens (not the same as Wrangler's auth). Scripts fail with auth errors.
**Why it happens:** R2 API tokens must be explicitly created in the Cloudflare dashboard (Settings > R2 > Manage API Tokens).
**How to avoid:** Document that R2 API tokens must be created before running migration. Store as environment variables, not in code. Note: "Currently, you cannot use AWS S3-compatible API while developing locally via wrangler dev" -- this is for Workers; our scripts use direct S3 API access which works fine.
**Warning signs:** 403 or SignatureDoesNotMatch errors from S3 client.

## Code Examples

### Shopify Product CSV Columns (verified)
```
Handle, Title, Body (HTML), Vendor, Type, Tags, Published,
Option1 Name, Option1 Value, Option2 Name, Option2 Value, Option3 Name, Option3 Value,
Variant SKU, Variant Grams, Variant Inventory Tracker, Variant Inventory Qty,
Variant Inventory Policy, Variant Fulfillment Service, Variant Price,
Variant Compare At Price, Variant Requires Shipping, Variant Taxable, Variant Barcode,
Image Src, Image Position, Image Alt Text,
SEO Title, SEO Description, Status
```

### Judge.me Review CSV Columns (verified)
```
title, body, rating, review_date, reviewer_name, reviewer_email,
product_id, product_handle, reply, picture_urls
```
Export also includes: source, publication status ("ok"/"spam"/"not-yet"), reviewer IP, location, custom form answers.

### Clerk createUser() for Migration (verified)
```typescript
// Source: https://clerk.com/docs/reference/backend/user/create-user
import { createClerkClient } from '@clerk/clerk-sdk-node';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const user = await clerk.users.createUser({
  emailAddress: ['customer@example.com'],
  firstName: 'Jane',
  lastName: 'Doe',
  skipPasswordRequirement: true, // No password needed -- user must reset
  publicMetadata: {
    shopifyCustomerId: '12345',
    migratedAt: new Date().toISOString(),
  },
});
// user.id is the Clerk user ID to store in Mercora customers table
```

### R2 Upload from Node.js (verified)
```typescript
// Source: https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// Upload image
await s3.send(new PutObjectCommand({
  Bucket: 'beauteas-images-dev',
  Key: 'products/clearly-calendula-morning.jpg',
  Body: imageBuffer,
  ContentType: 'image/jpeg',
}));

// List files for validation
const listing = await s3.send(new ListObjectsV2Command({
  Bucket: 'beauteas-images-dev',
  Prefix: 'products/',
}));
```

### Wrangler D1 Execute (verified)
```bash
# Execute SQL file against remote D1
npx wrangler d1 execute beauteas-db-dev --env dev --file=./migration-output.sql

# Execute inline SQL
npx wrangler d1 execute beauteas-db-dev --env dev --command="SELECT COUNT(*) FROM products"

# Execute against local D1 (for testing)
npx wrangler d1 execute beauteas-db-dev --local --file=./migration-output.sql
```

### Product Transform Example
```typescript
// Transform Shopify product to Mercora format
function transformProduct(shopify: ShopifyProduct, idMap: IdMap): MercoraProductInsert {
  const mercoraId = `PRD-${nanoid(8).toUpperCase()}`;
  idMap.register('products', shopify.id.toString(), mercoraId);

  // Map Shopify collection handles to Mercora category IDs
  const categories = shopify.collections?.map(handle =>
    idMap.resolve('categories', handle)
  ).filter(Boolean) as string[];

  return {
    id: mercoraId,
    name: shopify.title,  // Plain string, not localized for products
    description: JSON.stringify({ en: shopify.body_html }),
    slug: shopify.handle,  // Preserve Shopify handle as Mercora slug
    status: shopify.status === 'active' ? 'active' : 'draft',
    brand: 'BeauTeas',
    categories: JSON.stringify(categories),
    tags: JSON.stringify(shopify.tags?.split(', ') || []),
    options: shopify.options ? JSON.stringify(shopify.options.map(o => ({
      id: o.name.toLowerCase(),
      name: o.name,
      type: 'select',
      values: o.values.map(v => ({ id: v.toLowerCase().replace(/\s+/g, '-'), value: v })),
    }))) : null,
    fulfillment_type: 'physical',
    tax_category: 'food',
    external_references: JSON.stringify({ shopify_id: shopify.id.toString() }),
    created_at: shopify.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
```

### Redirect Map Table Schema
```sql
-- New migration: 0008_add_redirect_map.sql
CREATE TABLE IF NOT EXISTS redirect_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL UNIQUE,
  target_path TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 301,
  entity_type TEXT,  -- 'product', 'collection', 'page'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_redirect_source ON redirect_map(source_path);
```

### Middleware Redirect Lookup
```typescript
// Addition to middleware.ts for dynamic redirect lookup
// After maintenance mode check, before returning NextResponse.next()
const redirectRow = await db
  .select()
  .from(redirect_map)
  .where(eq(redirect_map.source_path, pathname))
  .limit(1);

if (redirectRow[0]) {
  return NextResponse.redirect(
    new URL(redirectRow[0].target_path, req.url),
    redirectRow[0].status_code
  );
}
```

## Dependency Ordering

Recommended entity migration order (based on foreign key and cross-reference dependencies):

1. **Categories** -- No dependencies. Creates ID map entries needed by products.
2. **Products + Variants + Images** -- Depends on categories (for category assignment). Downloads and uploads images to R2.
3. **Customers** -- No data dependencies, but Clerk API calls. Creates Clerk user IDs needed by orders and reviews.
4. **Orders** -- Depends on customers (customer_id) and products (items reference product IDs).
5. **Reviews** -- Depends on products (product_id) and optionally customers (customer_id for verified reviews).
6. **Pages** -- No dependencies on other migrated entities.
7. **Redirect Map** -- Depends on all above (needs migrated slugs/handles to build URL mappings).
8. **Validation** -- Runs after all entities, counts all tables.

## ID Mapping Strategy (Discretion Decision)

**Recommendation: Generate new prefixed nanoid IDs for all entities. Store Shopify IDs in `external_references`.**

Rationale:
- Existing Mercora data uses prefixed nanoids (PRD-XXXXXXXX, ORD-XXXXXXXX, REV-XXXXXXXXXX)
- Shopify IDs are numeric (e.g., 6652098674855) -- incompatible with Mercora ID conventions
- The `external_references` JSON field exists on products, categories, customers, and orders for exactly this purpose
- The ID map registry tracks Shopify-to-Mercora mappings for cross-referencing during migration

### ID Prefixes (from existing schema and seed data)
| Entity | Prefix | Length | Example |
|--------|--------|--------|---------|
| Product | prod_ | descriptive | prod_morning |
| Product Variant | variant_ | descriptive | variant_morning_1box |
| Order | ORD- | 8 | ORD-X5Y6Z7W8 |
| Review | REV- | 10 | REV-A1B2C3D4E5 |
| Customer | cust_p_ | timestamp+random | cust_p_1709712345_abc1234 |
| Category | cat_ | descriptive | cat_featured |

Note: Products and categories in existing seed data use descriptive IDs (prod_morning, cat_featured). Migration should match existing conventions where possible. For entities without existing conventions (orders from Shopify), use the prefixed nanoid pattern.

## Image Filename Convention (Discretion Decision)

**Recommendation: Use Mercora-style slugified filenames based on product name.**

Rationale:
- Existing R2 folder structure uses `products/clearly-calendula-morning.jpg` pattern
- Shopify CDN filenames are often random hashes or original upload names
- The existing `generateR2Filename()` in `lib/utils/r2.ts` slugifies text for clean filenames
- Pattern: `products/{product-slug}.jpg`, `products/{product-slug}-2.jpg` for additional images
- Category images: `categories/{category-slug}.png`

## Review order_id Constraint (Discretion Decision)

**Recommendation: Use a synthetic order reference `IMPORTED` as the order_id for migrated reviews.**

Rationale:
- Changing the schema to make order_id nullable would require a new migration and could break existing review submission logic
- A synthetic value keeps the NOT NULL constraint intact and makes imported reviews easily identifiable
- The `customer_id` should use `IMPORTED` unless the reviewer email matches a migrated customer (then use the mapped Clerk/Mercora customer ID)
- Set `is_verified` to `true` for imported reviews (they were published on Judge.me)
- Set `status` to `'published'` for reviews that were status "ok" in Judge.me

## Unmapped Shopify Fields (Discretion Decision)

**Recommendation: Store useful unmapped fields in `extensions` JSON; drop the rest.**

Fields to preserve in extensions:
- Product: ingredients, caffeine level, brewing instructions, certifications, benefits (already in extensions in seed data)
- Order: Shopify order name/number (e.g., #1001), financial_status, fulfillment_status
- Customer: total_spent, orders_count, accepts_marketing

Fields to drop:
- Shopify-specific IDs beyond the primary ID (variant_inventory_item_id, etc.)
- Shopify theme template suffixes
- Shopify-specific tax settings

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Shopify REST Admin API | GraphQL Admin API | Oct 2024 (REST is legacy) | REST still works for existing apps; new apps must use GraphQL from Apr 2025 |
| Bulk CSV import to Clerk | Clerk Backend API createUser() | Current | Direct API is appropriate for <1K users; bulk import is for 10K+ |
| Static redirect files | D1 redirect table + middleware | Phase 4 design | More flexible; can update without redeploy |

**Deprecated/outdated:**
- Shopify REST Admin API: Legacy as of Oct 2024, but still functional for existing integrations and private apps. For this migration, REST API is fine since it is a one-time operation.
- Shopify API version 2025-01: The latest stable version as of research date. API version 2026-01 is also available per Shopify docs.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None configured (no jest/vitest in project) |
| Config file | None |
| Quick run command | `npx tsc --noEmit` (type checking only) |
| Full suite command | `npx tsc --noEmit` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MIGR-01 | ETL scripts exist and compile | type-check | `npx tsc --noEmit` | N/A - Wave 0 |
| MIGR-02 | Products in D1 match source count | migration validation | `npx wrangler d1 execute beauteas-db-dev --env dev --command="SELECT COUNT(*) FROM products"` | Wave 0 |
| MIGR-03 | Categories in D1 match source count | migration validation | `npx wrangler d1 execute beauteas-db-dev --env dev --command="SELECT COUNT(*) FROM categories"` | Wave 0 |
| MIGR-04 | Clerk users created for all customers | migration validation | Clerk Dashboard check / validation script | Wave 0 |
| MIGR-05 | Orders in D1 match source count | migration validation | `npx wrangler d1 execute beauteas-db-dev --env dev --command="SELECT COUNT(*) FROM orders"` | Wave 0 |
| MIGR-06 | Reviews in D1 match source count, ratings recalculated | migration validation | `npx wrangler d1 execute beauteas-db-dev --env dev --command="SELECT COUNT(*) FROM product_reviews"` | Wave 0 |
| MIGR-07 | Pages in D1 match source count | migration validation | `npx wrangler d1 execute beauteas-db-dev --env dev --command="SELECT COUNT(*) FROM pages"` | Wave 0 |
| MIGR-08 | Redirect map populated | migration validation | `npx wrangler d1 execute beauteas-db-dev --env dev --command="SELECT COUNT(*) FROM redirect_map"` | Wave 0 |
| MIGR-09 | Validation report shows zero mismatches | migration validation | Built into orchestrator output | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit` (type check all migration scripts)
- **Per wave merge:** Run migration against local D1, verify validation report
- **Phase gate:** Full migration run against dev D1 with passing validation report

### Wave 0 Gaps
- [ ] `scripts/shopify-migration/` directory -- create entire migration script structure
- [ ] `migrations/0008_add_redirect_map.sql` -- new D1 migration for redirect table
- [ ] R2 API token creation -- must be done manually in Cloudflare dashboard before running
- [ ] Shopify Admin API credentials or export files -- must be provided by user

## Open Questions

1. **Shopify Admin API Access**
   - What we know: REST API 2025-01 (or 2026-01) is available, requires API key/secret
   - What's unclear: Whether the user has an existing private app with API credentials, or will provide CSV exports instead
   - Recommendation: Build both extractors. Default to file-based if no API credentials provided. The script config should accept either.

2. **Judge.me Data Format**
   - What we know: Judge.me exports CSV with standard columns (title, body, rating, reviewer_name, reviewer_email, product_handle, review_date, reply, picture_urls)
   - What's unclear: Exact export format the user will provide (CSV vs JSON, exact column names in their export)
   - Recommendation: Parse standard Judge.me CSV columns. Add column name normalization (lowercase, trim) to handle minor variations.

3. **Existing Seed Data Handling**
   - What we know: `data/d1/seed.sql` contains demo data (4 products, 7 variants, 7 categories)
   - What's unclear: Should migration replace seed data, or should seed data be cleared first?
   - Recommendation: Migration scripts should clear existing demo data from target tables before inserting (DELETE FROM products WHERE id LIKE 'prod_%'; etc.) The seed data uses known prefixes so this is safe.

4. **Variant ID Convention**
   - What we know: Existing variants use descriptive IDs like `variant_morning_1box`
   - What's unclear: Whether migrated variants should use the same descriptive convention or switch to prefixed nanoids
   - Recommendation: Use descriptive IDs derived from product slug + variant SKU for readability, matching existing convention. E.g., `variant_{product_slug}_{sku_suffix}`.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `lib/db/schema/products.ts`, `lib/db/schema/category.ts`, `lib/db/schema/customer.ts`, `lib/db/schema/order.ts`, `lib/db/schema/reviews.ts`, `lib/db/schema/pages.ts` -- definitive target schemas
- Existing codebase: `lib/utils/r2.ts` -- R2 upload patterns, folder structure, filename generation
- Existing codebase: `lib/utils/ratings.ts` -- Rating calculation helpers for review import
- Existing codebase: `data/d1/seed.sql` -- Reference data format and serialization patterns
- [Clerk createUser() docs](https://clerk.com/docs/reference/backend/user/create-user) -- skipPasswordRequirement parameter verified
- [Cloudflare R2 S3 SDK docs](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) -- S3Client setup verified
- [Cloudflare D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/) -- d1 execute syntax verified

### Secondary (MEDIUM confidence)
- [Shopify Admin REST API - Products](https://shopify.dev/docs/api/admin-rest/latest/resources/product) -- Product/variant/collection endpoints
- [Shopify Admin REST API - Customers](https://shopify.dev/docs/api/admin-rest/latest/resources/customer) -- Customer export fields
- [Judge.me Help Center - Exporting reviews](https://judge.me/help/en/articles/8236266-exporting-reviews) -- CSV export format and columns
- [Shopify Product CSV format](https://help.shopify.com/en/manual/products/import-export/using-csv) -- CSV column reference
- [Shopify Product CSV columns](https://www.webtoffee.com/docs/storerobo/manage-shopify-product-data-csv/) -- Complete column list

### Tertiary (LOW confidence)
- None -- all findings verified with primary or secondary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries either already installed or well-documented official tools
- Architecture: HIGH -- ETL pattern is well-established; all target schemas are in the codebase
- Pitfalls: HIGH -- identified from direct code inspection (JSON serialization, price formats, schema constraints)
- External APIs: MEDIUM -- Clerk and R2 APIs verified with docs; Shopify REST API is legacy but functional

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable domain, one-time migration)
