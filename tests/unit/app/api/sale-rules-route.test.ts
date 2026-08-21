/**
 * `GET /api/sale-rules` exists so the cart drawer and checkout page can render
 * the box-minimum prompt from settings rather than hardcoding 10 in two client
 * bundles. It exposes only the two public numbers — never the full settings
 * object, which carries operational keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const enforceRateLimit = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args),
  getClientIp: () => '1.2.3.4',
}));

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDbAsync: vi.fn() }));

const getSaleRules = vi.fn();
vi.mock('@/lib/sale/settings', () => ({ getSaleRules: (...a: unknown[]) => getSaleRules(...a) }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/sale-rules/route';

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue(null);
});

const get = () => GET(new NextRequest('http://localhost/api/sale-rules'));

describe('GET /api/sale-rules', () => {
  it('returns the minimum and the final-sale flag', async () => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: true,
      subscriptionsEnabled: false,
      tiers: [],
    });

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ minimumBoxes: 10, finalSale: true });
  });

  it('does not leak the rest of the sale settings', async () => {
    getSaleRules.mockResolvedValue({
      minimumBoxes: 10,
      finalSale: true,
      subscriptionsEnabled: false,
      tiers: [{ max_boxes: null, cost: 22 }],
    });

    const body = (await (await get()).json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(['finalSale', 'minimumBoxes']);
  });

  it('fails safe to a closed-sale posture when settings cannot be read', async () => {
    getSaleRules.mockRejectedValue(new Error('D1 unavailable'));

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ minimumBoxes: 10, finalSale: true });
  });
});
