/**
 * Final-review fix wave, item 6: /api/agent-chat fetched matched products by
 * id with no `isPubliclyPurchasableProduct` filter, unlike the homepage,
 * category pages, the sitemap, and /api/products — all of which filter. That
 * let Chai recommend an archived product (e.g. the GOOB-sale-archived Full
 * Package) at its old price, with a card whose click lands on /thank-you.
 *
 * Runs in the jsdom unit env, following the mocking pattern in
 * agent-chat-hardening.test.ts. `getDbAsync` is mocked with a minimal chain
 * that answers the two queries the handler actually makes in this path: the
 * `products` lookup by id, then a `product_variants` lookup per product.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn().mockResolvedValue({ userId: null, sessionClaims: null }),
}));

vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn().mockResolvedValue(null),
  getClientIp: vi.fn(() => '1.2.3.4'),
}));

vi.mock('@/lib/auth/unified-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { ADMIN_FULL: ['admin:*'] },
}));

vi.mock('@/lib/sale/settings', () => ({
  getSaleRules: vi.fn().mockResolvedValue({
    minimumBoxes: 10,
    finalSale: true,
    subscriptionsEnabled: false,
    tiers: [],
  }),
}));

// Bypass the deterministic-answer classifier entirely so every question in
// this file reaches the vector-search + product-hydration path under test,
// regardless of that module's regex table (deliberately not touched here —
// see deterministic-answers.ts's own history of hijack regressions).
vi.mock('@/lib/ai/deterministic-answers', () => ({
  classifyQuery: vi.fn(() => null),
  resolveDeterministicAnswer: vi.fn(),
}));

const aiRun = vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
const vectorizeQuery = vi.fn();
const getCloudflareContext = vi.fn().mockResolvedValue({
  env: { AI: { run: aiRun }, VECTORIZE: { query: (...args: unknown[]) => vectorizeQuery(...args) } },
});
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));

vi.mock('@/lib/ai/config', () => ({
  runAI: vi.fn().mockResolvedValue({}),
  getCurrentEmbeddingModel: vi.fn(() => '@cf/baai/bge-base-en-v1.5'),
  extractAIResponse: vi.fn(
    () => 'Our Clearly Calendula Morning blend could be lovely for your skin goals.'
  ),
}));

const getDbAsync = vi.fn();
vi.mock('@/lib/db', () => ({ getDbAsync: (...args: unknown[]) => getDbAsync(...args) }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/agent-chat/route';

/** First `.from()` call answers the `products` lookup; every call after answers a `product_variants` lookup. */
function mockDb(productRows: any[], variantRows: any[] = []) {
  let calls = 0;
  const fromMock = vi.fn(() => {
    calls += 1;
    const rows = calls === 1 ? productRows : variantRows;
    return { where: vi.fn().mockResolvedValue(rows) };
  });
  getDbAsync.mockResolvedValue({ select: vi.fn().mockReturnValue({ from: fromMock }) } as any);
}

const post = (question: string) =>
  POST(
    new NextRequest('http://localhost/api/agent-chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    })
  );

const ACTIVE_PRODUCT = {
  id: 'prod_clearly_calendula_morning',
  name: 'Clearly Calendula Morning',
  type: 'tea',
  status: 'active',
  slug: 'clearly-calendula-morning',
};

const ARCHIVED_PRODUCT = {
  id: 'prod_clearly_calendula_full_package',
  name: 'Clearly Calendula Full Package',
  type: 'bundle',
  status: 'archived',
  slug: 'clearly-calendula-full-package',
};

beforeEach(() => {
  vi.clearAllMocks();
  aiRun.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
  getCloudflareContext.mockResolvedValue({
    env: { AI: { run: aiRun }, VECTORIZE: { query: (...args: unknown[]) => vectorizeQuery(...args) } },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('/api/agent-chat withdrawn-product filtering (final-review fix, item 6)', () => {
  it('never returns an archived product Chai\'s vector search matched', async () => {
    vectorizeQuery.mockResolvedValue({
      matches: [
        { id: 'm1', metadata: { productId: ARCHIVED_PRODUCT.id, text: 'The Full Package bundle' } },
        { id: 'm2', metadata: { productId: ACTIVE_PRODUCT.id, text: 'Clearly Calendula Morning' } },
      ],
    });
    mockDb([ACTIVE_PRODUCT, ARCHIVED_PRODUCT]);

    const res = await post("What's a good tea for dry skin?");
    const body = (await res.json()) as { products: Array<{ id: string }> };

    expect(res.status).toBe(200);
    const returnedIds = body.products.map((p: any) => p.id);
    expect(returnedIds).toContain(ACTIVE_PRODUCT.id);
    expect(returnedIds).not.toContain(ARCHIVED_PRODUCT.id);
  });

  it('returns an empty products array when every vector match is withdrawn', async () => {
    vectorizeQuery.mockResolvedValue({
      matches: [{ id: 'm1', metadata: { productId: ARCHIVED_PRODUCT.id, text: 'The Full Package bundle' } }],
    });
    mockDb([ARCHIVED_PRODUCT]);

    const res = await post("What's a good tea for dry skin?");
    const body = (await res.json()) as { products: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(body.products).toEqual([]);
  });
});
