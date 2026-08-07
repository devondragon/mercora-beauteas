/**
 * The client-side read of `/api/sale-rules` had no coverage at all, which is
 * how the original bug shipped in two copies: both call sites did
 * `setMinimumBoxes(r.minimumBoxes)` with no `res.ok` check, so a rate-limited
 * 429 — whose JSON body parses fine, meaning `.catch()` never fires — stored
 * `undefined` and rendered "Add NaN more boxes to check out" behind a checkout
 * button that never enabled.
 *
 * These pin the three properties that prevent it recurring: status is checked
 * before the body is trusted, every field is type-validated, and the two fields
 * validate independently so one bad value can't reset the other.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSaleRulesBody, SALE_RULES_FALLBACK } from '@/lib/sale/use-sale-rules';
import { DEFAULT_MINIMUM_BOXES, checkMinimumOrder } from '@/lib/sale/rules';

describe('parseSaleRulesBody', () => {
  it('accepts a well-formed body', () => {
    const { rules, issues } = parseSaleRulesBody({ minimumBoxes: 6, finalSale: false });
    expect(rules).toEqual({ minimumBoxes: 6, finalSale: false });
    expect(issues).toEqual([]);
  });

  it('accepts a configured minimum of 0 — the predicate is >= 0, not > 0', () => {
    const { rules, issues } = parseSaleRulesBody({ minimumBoxes: 0, finalSale: true });
    expect(rules.minimumBoxes).toBe(0);
    expect(issues).toEqual([]);
  });

  it.each([
    ['missing', {}],
    ['undefined', { minimumBoxes: undefined }],
    ['null', { minimumBoxes: null }],
    ['a numeric string', { minimumBoxes: '10' }],
    ['NaN', { minimumBoxes: Number.NaN }],
    ['Infinity', { minimumBoxes: Number.POSITIVE_INFINITY }],
    ['negative', { minimumBoxes: -1 }],
  ])('defaults minimumBoxes when it is %s', (_label, body) => {
    const { rules, issues } = parseSaleRulesBody(body);
    expect(rules.minimumBoxes).toBe(DEFAULT_MINIMUM_BOXES);
    expect(issues.some((i) => i.includes('minimumBoxes'))).toBe(true);
  });

  it.each([
    ['null body', null],
    ['undefined body', undefined],
    ['an array', []],
    ['a string', 'not json'],
  ])('falls back on both fields given %s', (_label, body) => {
    expect(parseSaleRulesBody(body).rules).toEqual(SALE_RULES_FALLBACK);
  });

  it.each([
    ['missing', {}],
    ['null', { finalSale: null }],
    ['the string "false"', { finalSale: 'false' }],
    ['0', { finalSale: 0 }],
  ])('keeps the final-sale disclosure when finalSale is %s', (_label, body) => {
    // Fail-closed: only an explicit boolean false removes a legal disclosure.
    const { rules, issues } = parseSaleRulesBody(body);
    expect(rules.finalSale).toBe(true);
    expect(issues.some((i) => i.includes('finalSale'))).toBe(true);
  });

  it('honours an explicit finalSale: false', () => {
    expect(parseSaleRulesBody({ minimumBoxes: 10, finalSale: false }).rules.finalSale).toBe(false);
  });

  it('an unusable minimumBoxes does not discard a valid finalSale', () => {
    // The fields must validate independently — collapsing them would let a bad
    // number silently restore the disclosure an operator deliberately removed.
    const { rules } = parseSaleRulesBody({ minimumBoxes: 'nonsense', finalSale: false });
    expect(rules).toEqual({ minimumBoxes: DEFAULT_MINIMUM_BOXES, finalSale: false });
  });

  it('never yields a value that makes checkMinimumOrder go NaN', () => {
    const { rules } = parseSaleRulesBody({ error: 'Rate limit exceeded' });
    const result = checkMinimumOrder(6, rules.minimumBoxes);
    expect(Number.isFinite(result.short)).toBe(true);
    expect(result.short).toBe(DEFAULT_MINIMUM_BOXES - 6);
  });
});

describe('readSaleRules', () => {
  // The module caches at module scope, so each case needs a fresh import.
  async function freshModule() {
    vi.resetModules();
    return import('@/lib/sale/use-sale-rules');
  }

  function jsonResponse(body: unknown, init: { ok: boolean; status: number }) {
    return { ...init, json: async () => body } as Response;
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves the validated rules on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ minimumBoxes: 4, finalSale: false }, { ok: true, status: 200 })),
    );
    const { readSaleRules } = await freshModule();
    await expect(readSaleRules()).resolves.toEqual({ minimumBoxes: 4, finalSale: false });
  });

  it.each([
    ['429 from the rate limiter', 429, { error: 'Rate limit exceeded' }],
    ['500 with a JSON body', 500, { error: 'boom' }],
  ])('rejects on %s rather than trusting the body', async (_label, status, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(body, { ok: false, status })));
    const { readSaleRules } = await freshModule();
    await expect(readSaleRules()).rejects.toThrow(String(status));
  });

  it('rejects when fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { readSaleRules } = await freshModule();
    await expect(readSaleRules()).rejects.toThrow('offline');
  });

  it('rejects when the body is not JSON at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response),
    );
    const { readSaleRules } = await freshModule();
    await expect(readSaleRules()).rejects.toThrow(SyntaxError);
  });

  it('issues one request for concurrent callers', async () => {
    // HeaderClient mounts two CartDrawers, so /checkout produced three calls
    // against the budget /api/payment-intent shares.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ minimumBoxes: 10, finalSale: true }, { ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { readSaleRules } = await freshModule();

    const results = await Promise.all([readSaleRules(), readSaleRules(), readSaleRules()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { minimumBoxes: 10, finalSale: true },
      { minimumBoxes: 10, finalSale: true },
      { minimumBoxes: 10, finalSale: true },
    ]);
  });

  it('does not cache a failure, so a transient 429 is retried', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Rate limit exceeded' }, { ok: false, status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ minimumBoxes: 10, finalSale: true }, { ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { readSaleRules } = await freshModule();

    await expect(readSaleRules()).rejects.toThrow('429');
    await expect(readSaleRules()).resolves.toEqual({ minimumBoxes: 10, finalSale: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves a cached success without refetching', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ minimumBoxes: 8, finalSale: true }, { ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { readSaleRules } = await freshModule();

    await readSaleRules();
    await expect(readSaleRules()).resolves.toEqual({ minimumBoxes: 8, finalSale: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
