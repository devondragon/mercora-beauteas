import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sha256Hex } from '@/lib/auth/crypto';

// BMC-141 (H4) / BMC-155 (L5): MCP agent API keys must be stored and looked up
// by SHA-256 hash — never as raw plaintext — mirroring api_tokens.token_hash.
// These tests pin the invariant at both boundaries:
//   - createAgent() persists sha256Hex(rawKey), not the raw key, and still
//     returns the raw key to the caller once.
//   - authenticateAgent() hashes the presented key and matches on the hash
//     column (the indexed hash-equality lookup that also removes the
//     plaintext-compare timing concern from L5).

// Capture the arguments drizzle's eq() is called with so we can prove the
// lookup targets apiKeyHash with the hashed value. and()/gte()/sql() keep their
// real behavior — the fake db ignores the composed where clause anyway.
const eqCalls: Array<[unknown, unknown]> = [];
vi.mock('drizzle-orm', async (importActual) => {
  const actual = await importActual<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => {
      eqCalls.push([col, val]);
      return actual.eq(col as never, val as never);
    },
  };
});

// A chainable fake matching the drizzle query-builder surface auth.ts uses.
let insertedValues: Record<string, unknown> | undefined;
let selectResult: unknown[] = [];

function makeChain() {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.from = passthrough;
  chain.where = passthrough;
  chain.set = passthrough;
  chain.orderBy = passthrough;
  chain.offset = passthrough;
  chain.limit = () => Promise.resolve(selectResult);
  chain.values = (v: Record<string, unknown>) => {
    insertedValues = v;
    return Promise.resolve(undefined);
  };
  chain.onConflictDoUpdate = () => Promise.resolve(undefined);
  return chain;
}

const fakeDb = {
  select: () => makeChain(),
  insert: () => makeChain(),
  update: () => makeChain(),
  batch: () => Promise.resolve([]),
};

vi.mock('@/lib/db', () => ({
  getDbAsync: vi.fn(async () => fakeDb),
}));

import { createAgent, authenticateAgent } from '@/lib/mcp/auth';

beforeEach(() => {
  eqCalls.length = 0;
  insertedValues = undefined;
  selectResult = [];
});

describe('createAgent', () => {
  it('stores the SHA-256 hash of the key, never the raw key', async () => {
    const { apiKey } = await createAgent({ agentId: 'agent-1', name: 'Agent One' });

    expect(apiKey).toMatch(/^mcp_/);
    expect(insertedValues).toBeDefined();
    // The persisted column is the hash, and it is NOT the raw key.
    expect(insertedValues!.apiKeyHash).toBe(await sha256Hex(apiKey));
    expect(insertedValues!.apiKeyHash).not.toBe(apiKey);
    // The raw key must never be persisted under any column.
    expect(Object.values(insertedValues!)).not.toContain(apiKey);
  });
});

describe('authenticateAgent', () => {
  it('hashes the presented key and matches on the hash column', async () => {
    const presentedKey = 'test-key-123';
    const req = {
      headers: { get: (h: string) => (h === 'X-Agent-API-Key' ? presentedKey : null) },
      nextUrl: { searchParams: { get: () => null } },
    } as unknown as import('next/server').NextRequest;

    // No matching row -> returns INVALID_API_KEY, but the lookup still ran.
    const result = await authenticateAgent(req);
    expect(result.success).toBe(false);

    const expectedHash = await sha256Hex(presentedKey);
    // The raw key must never appear in a query predicate...
    expect(eqCalls.some(([, val]) => val === presentedKey)).toBe(false);
    // ...and the hash must be what we matched on.
    expect(eqCalls.some(([, val]) => val === expectedHash)).toBe(true);
  });
});
