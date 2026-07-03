/**
 * Regression test for BMC-133 / C7 + C8 — MCP agent-management authorization.
 *
 * The agent-management tools (create_agent, list_agents, get_agent_details,
 * update_agent_status) let a caller mint/enumerate/inspect/disable other agents
 * and read their session ids. They previously ran for ANY authenticated agent
 * with no privilege check, so a plain commerce agent could enumerate the fleet
 * and harvest other agents' session ids (C7) or deactivate them (C8).
 *
 * The fix gates these tools behind hasAgentManagementPermission (admin /
 * agents:manage / *), failing closed. The JSON dispatcher (POST /api/mcp) is
 * the primary path callers reach these tools by, so the gate is tested here.
 *
 * Mocks authenticateAgent (keeping the REAL hasAgentManagementPermission via
 * importActual) and the agent tool module so nothing touches D1 — runs in the
 * jsdom unit env (CI `npm test`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/mcp/auth', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/mcp/auth')>();
  return {
    ...actual,
    authenticateAgent: vi.fn(),
  };
});

vi.mock('@/lib/mcp/tools/agent', () => ({
  createAgent: vi.fn().mockResolvedValue({ success: true }),
  listAgents: vi.fn().mockResolvedValue({ success: true }),
  getAgentDetails: vi.fn().mockResolvedValue({ success: true }),
  updateAgentStatus: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/mcp/tools/recommend', () => ({
  getRecommendations: vi.fn().mockResolvedValue({ success: true }),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/mcp/route';
import { authenticateAgent } from '@/lib/mcp/auth';
import {
  createAgent,
  listAgents,
  getAgentDetails,
  updateAgentStatus,
} from '@/lib/mcp/tools/agent';

const url = 'http://localhost/api/mcp';

function postTool(tool: string, params: Record<string, unknown> = {}) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify({ tool, params, session_id: 's1' }),
  });
}

const MANAGEMENT_TOOLS: Array<[string, ReturnType<typeof vi.fn>]> = [
  ['create_agent', vi.mocked(createAgent)],
  ['list_agents', vi.mocked(listAgents)],
  ['get_agent_details', vi.mocked(getAgentDetails)],
  ['update_agent_status', vi.mocked(updateAgentStatus)],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP agent-management authorization (BMC-133 / C7+C8)', () => {
  it.each(MANAGEMENT_TOOLS)(
    '%s is rejected with 403 for an authenticated agent without management permission, and the tool never runs',
    async (tool, toolFn) => {
      vi.mocked(authenticateAgent).mockResolvedValue({
        success: true,
        agentId: 'agent-commerce',
        permissions: ['search', 'cart'],
      });

      const res = await POST(postTool(tool, { agentId: 'agent-victim', isActive: false }));

      expect(res.status).toBe(403);
      expect(toolFn).not.toHaveBeenCalled();
    }
  );

  it.each(MANAGEMENT_TOOLS)(
    '%s is rejected with 403 when the agent has no permissions at all',
    async (tool, toolFn) => {
      vi.mocked(authenticateAgent).mockResolvedValue({
        success: true,
        agentId: 'agent-commerce',
        permissions: [],
      });

      const res = await POST(postTool(tool, { agentId: 'agent-victim', isActive: true }));

      expect(res.status).toBe(403);
      expect(toolFn).not.toHaveBeenCalled();
    }
  );

  it.each([['admin'], ['agents:manage'], ['*']])(
    'allows a privileged agent (permission %s) through to the management tool',
    async (permission) => {
      vi.mocked(authenticateAgent).mockResolvedValue({
        success: true,
        agentId: 'agent-admin',
        permissions: [permission],
      });

      const res = await POST(postTool('get_agent_details', { agentId: 'agent-victim' }));

      expect(res.status).toBe(200);
      expect(vi.mocked(getAgentDetails)).toHaveBeenCalledWith('agent-victim', 's1', 'agent-admin');
    }
  );

  it('does not apply the management gate to ordinary commerce tools', async () => {
    // A non-management tool with an unprivileged agent must not be 403'd by the
    // management gate. get_recommendations dispatches to the recommend tool,
    // which is stubbed above so no D1 is touched.
    vi.mocked(authenticateAgent).mockResolvedValue({
      success: true,
      agentId: 'agent-commerce',
      permissions: [],
    });

    const res = await POST(postTool('get_recommendations', { query: 'tea' }));

    expect(res.status).not.toBe(403);
  });
});
