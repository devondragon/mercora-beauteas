/**
 * File-Based Customer Extractor
 *
 * Reads Shopify customer data from CSV or JSON export files.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv, readJson } from '../../lib/csv-reader.js';
import type { ExtractResult, ShopifyCustomer, ShopifyCustomerAddress } from '../../lib/types.js';

/**
 * Extract customers from file (CSV or JSON).
 */
export function extractCustomersFromFile(
  dataDir: string
): ExtractResult<ShopifyCustomer> {
  const jsonPath = join(dataDir, 'customers.json');
  const csvPath = join(dataDir, 'customers.csv');

  let records: ShopifyCustomer[];

  if (existsSync(jsonPath)) {
    records = readJson<ShopifyCustomer>(jsonPath);
  } else if (existsSync(csvPath)) {
    records = readCsv<ShopifyCustomer>(csvPath, (row) => {
      // Parse addresses from CSV - typically a default address is inline
      const defaultAddress: ShopifyCustomerAddress = {
        address1: row['Address1'] || row['address1'] || undefined,
        address2: row['Address2'] || row['address2'] || undefined,
        city: row['City'] || row['city'] || undefined,
        province: row['Province'] || row['province'] || undefined,
        province_code:
          row['Province Code'] || row['province_code'] || undefined,
        country: row['Country'] || row['country'] || undefined,
        country_code:
          row['Country Code'] || row['country_code'] || undefined,
        zip: row['Zip'] || row['zip'] || undefined,
        phone: row['Phone'] || row['phone'] || undefined,
      };

      const hasAddress = defaultAddress.address1 || defaultAddress.city;

      return {
        id: row['Id'] || row['id'] || '',
        email: row['Email'] || row['email'] || '',
        first_name: row['First Name'] || row['first_name'] || undefined,
        last_name: row['Last Name'] || row['last_name'] || undefined,
        phone: row['Phone'] || row['phone'] || undefined,
        total_spent: row['Total Spent'] || row['total_spent'] || undefined,
        orders_count: row['Orders Count'] || row['orders_count']
          ? parseInt(row['Orders Count'] || row['orders_count'], 10)
          : undefined,
        accepts_marketing:
          (row['Accepts Marketing'] || row['accepts_marketing'] || '')
            .toLowerCase() === 'yes' ||
          (row['Accepts Marketing'] || row['accepts_marketing'] || '')
            .toLowerCase() === 'true',
        tags: row['Tags'] || row['tags'] || undefined,
        created_at: row['Created At'] || row['created_at'] || undefined,
        updated_at: row['Updated At'] || row['updated_at'] || undefined,
        default_address: hasAddress ? defaultAddress : undefined,
        addresses: hasAddress ? [defaultAddress] : [],
      };
    });
  } else {
    throw new Error(
      `No customer data file found. Expected ${jsonPath} or ${csvPath}`
    );
  }

  return {
    records,
    source: 'file',
    extractedAt: new Date().toISOString(),
  };
}
