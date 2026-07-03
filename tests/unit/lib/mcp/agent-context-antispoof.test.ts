/**
 * Regression test for BMC-133 — MCP agent_context anti-spoofing.
 *
 * The X-Agent-Context header (and, on the JSON dispatcher, the request body's
 * agent_context) is fully client-controlled. Its agentId must never be trusted
 * for attribution: once the caller is authenticated, parseAgentContext must
 * force context.agentId to the authenticated agent so a forged agentId can't be
 * attached to response context or persisted onto an order.
 *
 * Pure function — no D1/Cloudflare bindings — so it runs directly in the jsdom
 * unit env (CI `npm test`).
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { parseAgentContext } from '@/lib/mcp/context';

const url = 'http://localhost/api/mcp';

function requestWithContext(ctx: unknown): NextRequest {
  return new NextRequest(url, {
    headers: { 'X-Agent-Context': JSON.stringify(ctx) },
  });
}

describe('parseAgentContext anti-spoof (BMC-133)', () => {
  it('overwrites a forged context.agentId with the authenticated agentId', () => {
    const result = parseAgentContext(
      requestWithContext({ agentId: 'agent-victim', userPreferences: { budget: 50 } }),
      'agent-a'
    );

    expect(result).not.toBeNull();
    expect(result!.agentId).toBe('agent-a');
    // Non-identity fields are preserved untouched.
    expect(result!.userPreferences?.budget).toBe(50);
  });

  it('forces the authenticated agentId even when the header omits agentId-matching intent', () => {
    // Attacker impersonating a well-known privileged id.
    const result = parseAgentContext(
      requestWithContext({ agentId: 'admin' }),
      'agent-untrusted'
    );

    expect(result!.agentId).toBe('agent-untrusted');
  });

  it('leaves agentId as-supplied when no authenticated agentId is passed (pre-auth callers)', () => {
    const result = parseAgentContext(requestWithContext({ agentId: 'agent-x' }));

    expect(result!.agentId).toBe('agent-x');
  });

  it('returns null (not a throw) when no X-Agent-Context header is present', () => {
    expect(parseAgentContext(new NextRequest(url), 'agent-a')).toBeNull();
  });

  it('returns null when the header agentId is missing/invalid, even with an authenticated caller', () => {
    // Validation runs before the forcing step, so a structurally invalid
    // context is rejected rather than silently rebuilt from the auth id.
    expect(parseAgentContext(requestWithContext({ notAgentId: true }), 'agent-a')).toBeNull();
  });
});
