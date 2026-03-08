/**
 * ID Mapping Registry
 *
 * Tracks Shopify ID -> Mercora ID mappings across entities.
 * Persisted to JSON for re-runs and cross-entity references.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export class IdMap {
  private maps: Record<string, Map<string, string>> = {};

  /**
   * Register a mapping from Shopify ID to Mercora ID
   */
  register(entity: string, shopifyId: string, mercoraId: string): void {
    if (!this.maps[entity]) {
      this.maps[entity] = new Map();
    }
    this.maps[entity].set(shopifyId, mercoraId);
  }

  /**
   * Resolve a Shopify ID to its Mercora ID
   */
  resolve(entity: string, shopifyId: string): string | undefined {
    return this.maps[entity]?.get(shopifyId);
  }

  /**
   * Get all mappings for an entity
   */
  getAll(entity: string): Map<string, string> {
    return this.maps[entity] ?? new Map();
  }

  /**
   * Get count of registered entries for an entity
   */
  count(entity: string): number {
    return this.maps[entity]?.size ?? 0;
  }

  /**
   * Save ID map to JSON file
   */
  save(path: string): void {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const serialized: Record<string, Record<string, string>> = {};
    for (const [entity, map] of Object.entries(this.maps)) {
      serialized[entity] = Object.fromEntries(map);
    }

    writeFileSync(path, JSON.stringify(serialized, null, 2), 'utf-8');
  }

  /**
   * Load ID map from JSON file
   */
  load(path: string): void {
    if (!existsSync(path)) {
      return;
    }

    const data = JSON.parse(readFileSync(path, 'utf-8'));
    for (const [entity, entries] of Object.entries(data as Record<string, Record<string, string>>)) {
      this.maps[entity] = new Map(Object.entries(entries));
    }
  }
}

/** Default ID map file path */
export const DEFAULT_ID_MAP_PATH = 'scripts/shopify-migration/output/id-map.json';

/** Singleton instance */
export const idMap = new IdMap();
