/**
 * File-Based Order Extractor
 *
 * Reads Shopify order data from CSV or JSON export files.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv, readJson } from '../../lib/csv-reader.js';
import type { ExtractResult, ShopifyOrder } from '../../lib/types.js';

/**
 * Extract orders from file (CSV or JSON).
 *
 * JSON is the preferred format for orders since line_items are nested.
 * CSV extraction provides basic order fields but cannot represent nested line_items.
 */
export function extractOrdersFromFile(
  dataDir: string
): ExtractResult<ShopifyOrder> {
  const jsonPath = join(dataDir, 'orders.json');
  const csvPath = join(dataDir, 'orders.csv');

  let records: ShopifyOrder[];

  if (existsSync(jsonPath)) {
    records = readJson<ShopifyOrder>(jsonPath);
  } else if (existsSync(csvPath)) {
    records = readCsv<ShopifyOrder>(csvPath, (row) => {
      // CSV orders have flattened structure -- limited representation
      return {
        id: row['Id'] || row['id'] || row['Name'] || '',
        name: row['Name'] || row['name'] || undefined,
        email: row['Email'] || row['email'] || undefined,
        financial_status:
          row['Financial Status'] || row['financial_status'] || undefined,
        fulfillment_status:
          row['Fulfillment Status'] || row['fulfillment_status'] || undefined,
        total_price: row['Total'] || row['total_price'] || '0',
        subtotal_price: row['Subtotal'] || row['subtotal_price'] || undefined,
        total_tax: row['Taxes'] || row['total_tax'] || undefined,
        total_discounts:
          row['Discount Amount'] || row['total_discounts'] || undefined,
        currency: row['Currency'] || row['currency'] || 'USD',
        line_items: [], // Cannot parse nested line_items from CSV
        shipping_address: row['Shipping Street']
          ? {
              address1: row['Shipping Street'],
              city: row['Shipping City'],
              province: row['Shipping Province'],
              country: row['Shipping Country'],
              zip: row['Shipping Zip'],
            }
          : undefined,
        billing_address: row['Billing Street']
          ? {
              address1: row['Billing Street'],
              city: row['Billing City'],
              province: row['Billing Province'],
              country: row['Billing Country'],
              zip: row['Billing Zip'],
            }
          : undefined,
        created_at: row['Created at'] || row['created_at'] || undefined,
        updated_at: row['Updated at'] || row['updated_at'] || undefined,
        cancelled_at:
          row['Cancelled at'] || row['cancelled_at'] || undefined,
        tags: row['Tags'] || row['tags'] || undefined,
        note: row['Notes'] || row['note'] || undefined,
        customer: row['Customer: Id'] || row['customer_id']
          ? { id: parseInt(row['Customer: Id'] || row['customer_id'], 10) }
          : undefined,
      };
    });
  } else {
    throw new Error(
      `No order data file found. Expected ${jsonPath} or ${csvPath}`
    );
  }

  return {
    records,
    source: 'file',
    extractedAt: new Date().toISOString(),
  };
}
