/**
 * Migration Configuration
 *
 * Reads environment variables for Shopify API, R2, D1, and Clerk access.
 * Validates required vars based on extraction mode.
 */

export interface MigrationConfig {
  // Shopify API (required for 'api' extraction mode)
  shopifyApiKey?: string;
  shopifyApiSecret?: string;
  shopifyStoreUrl?: string;
  shopifyApiVersion: string;

  // Clerk (for customer migration)
  clerkSecretKey?: string;

  // R2 (for image uploads)
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2AccountId?: string;
  r2BucketName: string;

  // D1 (via wrangler)
  d1DatabaseName: string;
  d1Env: string;

  // Extraction mode
  extractionMode: 'api' | 'file';
  dataDir: string;
}

export function getConfig(): MigrationConfig {
  const extractionMode = (process.env.EXTRACTION_MODE ?? 'file') as 'api' | 'file';

  const config: MigrationConfig = {
    shopifyApiKey: process.env.SHOPIFY_API_KEY,
    shopifyApiSecret: process.env.SHOPIFY_API_SECRET,
    shopifyStoreUrl: process.env.SHOPIFY_STORE_URL,
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION ?? '2025-01',

    clerkSecretKey: process.env.CLERK_SECRET_KEY,

    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    r2AccountId: process.env.R2_ACCOUNT_ID,
    r2BucketName: process.env.R2_BUCKET_NAME ?? 'beauteas-images-dev',

    d1DatabaseName: process.env.D1_DATABASE_NAME ?? 'beauteas-db-dev',
    d1Env: process.env.D1_ENV ?? 'dev',

    extractionMode,
    dataDir: process.env.DATA_DIR ?? 'scripts/shopify-migration/data/',
  };

  // Validate required vars based on extraction mode
  if (extractionMode === 'api') {
    const missing: string[] = [];
    if (!config.shopifyApiKey) missing.push('SHOPIFY_API_KEY');
    if (!config.shopifyStoreUrl) missing.push('SHOPIFY_STORE_URL');

    if (missing.length > 0) {
      throw new Error(
        `API extraction mode requires: ${missing.join(', ')}\n` +
        'Set these environment variables or use EXTRACTION_MODE=file'
      );
    }
  }

  return config;
}
