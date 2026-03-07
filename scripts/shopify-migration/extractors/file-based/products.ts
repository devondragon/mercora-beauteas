/**
 * File-Based Product Extractor
 *
 * Reads Shopify products from CSV export files.
 * Groups rows by Handle (Shopify CSV has one row per variant,
 * with multiple rows per product).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExtractResult,
  ShopifyProduct,
  ShopifyProductVariant,
  ShopifyProductImage,
  ShopifyProductOption,
} from '../../lib/types.js';
import { readCsv, readJson } from '../../lib/csv-reader.js';
import { logger } from '../../lib/logger.js';

/**
 * Extract products from Shopify CSV export.
 *
 * Shopify CSV format: one row per variant. The first row for a Handle
 * contains product-level data; subsequent rows have only variant/image data.
 */
export function extractProductsFromFile(
  dataDir: string
): ExtractResult<ShopifyProduct> {
  const jsonPath = join(dataDir, 'products.json');
  const csvPath = join(dataDir, 'products.csv');

  if (existsSync(jsonPath)) {
    logger.info(`Reading products from JSON: ${jsonPath}`);
    const records = readJson<ShopifyProduct>(jsonPath);
    logger.info(`Extracted ${records.length} products from JSON`);
    return {
      records,
      source: 'file',
      extractedAt: new Date().toISOString(),
    };
  }

  if (!existsSync(csvPath)) {
    throw new Error(
      `No products data file found. Expected ${jsonPath} or ${csvPath}`
    );
  }

  logger.info(`Reading products from CSV: ${csvPath}`);
  const rows = readCsv(csvPath);

  // Group rows by Handle
  const productMap = new Map<string, Record<string, string>[]>();
  for (const row of rows) {
    const handle = row['Handle'] ?? '';
    if (!handle) continue;
    if (!productMap.has(handle)) {
      productMap.set(handle, []);
    }
    productMap.get(handle)!.push(row);
  }

  const products: ShopifyProduct[] = [];

  for (const [handle, rowGroup] of productMap) {
    const firstRow = rowGroup[0];

    // Parse options from the first row
    const options: ShopifyProductOption[] = [];
    const optionValues: Map<string, Set<string>> = new Map();

    for (let optIdx = 1; optIdx <= 3; optIdx++) {
      const optName = firstRow[`Option${optIdx} Name`];
      if (optName && optName !== '') {
        options.push({
          name: optName,
          position: optIdx,
          values: [],
        });
        optionValues.set(optName, new Set());
      }
    }

    // Parse variants and images from all rows
    const variants: ShopifyProductVariant[] = [];
    const images: ShopifyProductImage[] = [];
    const seenImageSrcs = new Set<string>();

    for (const row of rowGroup) {
      // Parse variant data
      const variantPrice = row['Variant Price'];
      if (variantPrice) {
        const variant: ShopifyProductVariant = {
          sku: row['Variant SKU'] ?? '',
          price: variantPrice,
          compare_at_price: row['Variant Compare At Price'] || null,
          grams: parseInt(row['Variant Grams'] ?? '0', 10) || 0,
          inventory_quantity: parseInt(row['Variant Inventory Qty'] ?? '0', 10),
          inventory_policy: row['Variant Inventory Policy'] ?? 'deny',
          inventory_management: row['Variant Inventory Tracker'] ?? null,
          fulfillment_service: row['Variant Fulfillment Service'] ?? 'manual',
          requires_shipping:
            row['Variant Requires Shipping']?.toLowerCase() !== 'false',
          taxable: row['Variant Taxable']?.toLowerCase() !== 'false',
          barcode: row['Variant Barcode'] || null,
          option1: row['Option1 Value'] || null,
          option2: row['Option2 Value'] || null,
          option3: row['Option3 Value'] || null,
          position: variants.length + 1,
        };
        variants.push(variant);

        // Collect option values
        for (let optIdx = 1; optIdx <= 3; optIdx++) {
          const optName = row[`Option${optIdx} Name`] || firstRow[`Option${optIdx} Name`];
          const optValue = row[`Option${optIdx} Value`];
          if (optName && optValue && optionValues.has(optName)) {
            optionValues.get(optName)!.add(optValue);
          }
        }
      }

      // Parse image data
      const imageSrc = row['Image Src'];
      if (imageSrc && !seenImageSrcs.has(imageSrc)) {
        seenImageSrcs.add(imageSrc);
        images.push({
          src: imageSrc,
          position: parseInt(row['Image Position'] ?? String(images.length + 1), 10),
          alt: row['Image Alt Text'] || null,
        });
      }
    }

    // Fill option values
    for (const option of options) {
      const values = optionValues.get(option.name);
      if (values) {
        option.values = Array.from(values);
      }
    }

    const product: ShopifyProduct = {
      id: handle, // Use handle as ID for file-based extraction
      title: firstRow['Title'] ?? '',
      body_html: firstRow['Body (HTML)'] ?? '',
      handle,
      vendor: firstRow['Vendor'] ?? '',
      product_type: firstRow['Type'] ?? '',
      tags: firstRow['Tags'] ?? '',
      status: (firstRow['Status'] ?? 'active').toLowerCase(),
      published_at:
        firstRow['Published']?.toLowerCase() === 'true'
          ? new Date().toISOString()
          : null,
      variants,
      images,
      options: options.length > 0 ? options : undefined,
      seo_title: firstRow['SEO Title'] || undefined,
      seo_description: firstRow['SEO Description'] || undefined,
    };

    products.push(product);
  }

  logger.info(`Extracted ${products.length} products from CSV`);

  return {
    records: products,
    source: 'file',
    extractedAt: new Date().toISOString(),
  };
}
