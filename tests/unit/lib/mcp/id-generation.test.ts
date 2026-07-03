import { describe, it, expect } from 'vitest';
import { generateApiKey } from '@/lib/mcp/auth';
import { createAgentSessionId } from '@/lib/mcp/context';

// BMC-147: generateApiKey() and createAgentSessionId() used
// `Date.now() + Math.random().toString(36)` to build the unpredictable part
// of MCP API keys and agent session IDs. Math.random() is not a CSPRNG and
// Date.now() narrows the search space further, making both identifiers
// guessable. Both now use crypto.randomUUID() (Web Crypto — global in the
// Workers runtime, Node 20+, and jsdom) for >=122 bits of secure entropy.
//
// These tests assert format/uniqueness/entropy, not the absence of
// Math.random(), since that's an implementation detail.
describe('generateApiKey', () => {
  it('is prefixed with mcp_', () => {
    const apiKey = generateApiKey();
    expect(apiKey).toMatch(/^mcp_/);
  });

  it('produces a high-entropy suffix (>=32 hex chars, i.e. >=122 bits)', () => {
    const apiKey = generateApiKey();
    const suffix = apiKey.replace(/^mcp_/, '');
    expect(suffix.length).toBeGreaterThanOrEqual(32);
    expect(suffix).toMatch(/^[0-9a-f]+$/);
  });

  it('produces distinct values across calls', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));
    expect(keys.size).toBe(50);
  });
});

describe('createAgentSessionId', () => {
  it('is prefixed with the given agentId', () => {
    const sessionId = createAgentSessionId('agent-x');
    expect(sessionId.startsWith('agent-x_')).toBe(true);
  });

  it('produces a high-entropy suffix (>=32 hex chars, i.e. >=122 bits)', () => {
    const sessionId = createAgentSessionId('agent-x');
    const suffix = sessionId.slice('agent-x_'.length).replace(/-/g, '');
    expect(suffix.length).toBeGreaterThanOrEqual(32);
    expect(suffix).toMatch(/^[0-9a-f]+$/);
  });

  it('produces distinct values across calls for the same agentId', () => {
    const ids = new Set(Array.from({ length: 50 }, () => createAgentSessionId('agent-x')));
    expect(ids.size).toBe(50);
  });
});
