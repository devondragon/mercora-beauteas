/**
 * R2 Client for Migration Scripts
 *
 * Uses @aws-sdk/client-s3 to interact with Cloudflare R2 via S3-compatible API.
 * Cannot use R2Bucket binding (Workers only); uses API tokens for external access.
 */

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { MigrationConfig } from './config.js';

let s3Client: S3Client | null = null;

/**
 * Get or create the S3 client for R2
 */
function getClient(config: MigrationConfig): S3Client {
  if (s3Client) return s3Client;

  if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey) {
    throw new Error(
      'R2 credentials required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY'
    );
  }

  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  });

  return s3Client;
}

/**
 * Upload a buffer to R2
 */
export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string,
  config: MigrationConfig
): Promise<void> {
  const client = getClient(config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.r2BucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

/**
 * Download a file from a URL with exponential backoff retry.
 * Returns null on final failure (log and continue).
 */
export async function downloadWithRetry(
  url: string,
  maxRetries: number = 3
): Promise<Buffer | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(
          `Failed to download after ${maxRetries} attempts: ${url}`,
          error instanceof Error ? error.message : error
        );
        return null;
      }
      const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return null;
}

/**
 * List files in R2 with a prefix (for validation)
 */
export async function listR2Files(
  prefix: string,
  config: MigrationConfig
): Promise<string[]> {
  const client = getClient(config);
  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: config.r2BucketName,
      Prefix: prefix,
    })
  );
  return (result.Contents ?? []).map((obj) => obj.Key ?? '').filter(Boolean);
}

/**
 * Map file extensions to MIME types
 */
export function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
