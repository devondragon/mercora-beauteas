/**
 * R2 Loader
 *
 * Downloads images from Shopify CDN and uploads to Cloudflare R2.
 */

import type { MigrationConfig } from '../lib/config.js';
import { downloadWithRetry, uploadToR2, getContentType } from '../lib/r2-client.js';
import { logger } from '../lib/logger.js';

export interface ImageUploadItem {
  sourceUrl: string;
  r2Key: string;
}

export interface ImageUploadResult {
  uploaded: number;
  failed: string[];
}

/**
 * Upload images from source URLs to R2.
 *
 * Downloads each image with retry, then uploads to R2.
 * Logs failures but continues processing.
 */
export async function uploadImages(
  images: ImageUploadItem[],
  config: MigrationConfig
): Promise<ImageUploadResult> {
  const result: ImageUploadResult = {
    uploaded: 0,
    failed: [],
  };

  for (const { sourceUrl, r2Key } of images) {
    const buffer = await downloadWithRetry(sourceUrl);
    if (!buffer) {
      logger.warn(`Skipping image (download failed): ${sourceUrl}`);
      result.failed.push(sourceUrl);
      continue;
    }

    try {
      const contentType = getContentType(r2Key);
      await uploadToR2(r2Key, buffer, contentType, config);
      result.uploaded++;
      logger.info(`Uploaded: ${r2Key}`);
    } catch (error) {
      logger.error(`Failed to upload ${r2Key}`, error);
      result.failed.push(sourceUrl);
    }
  }

  return result;
}
