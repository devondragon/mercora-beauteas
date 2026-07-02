import { NextRequest } from 'next/server';
import { getDbAsync } from '../db';
import { mcpAgents, mcpRateLimits } from '../db/schema/mcp';
import { eq, and, gte, sql } from 'drizzle-orm';
import { MCPError } from './types';
import { AuthenticationError, RateLimitError, DatabaseError } from './error-handler';

export interface AgentAuthResult {
  success: boolean;
  agentId?: string;
  error?: MCPError['error'];
}

export async function authenticateAgent(
  request: NextRequest,
  opts: { isOrderOp?: boolean } = {}
): Promise<AgentAuthResult> {
  const { isOrderOp = false } = opts;
  const apiKey = request.headers.get('X-Agent-API-Key') ||
                 request.headers.get('Authorization')?.replace('Bearer ', '') ||
                 request.nextUrl.searchParams.get('api_key');

  if (!apiKey) {
    return {
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: 'Agent API key required in X-Agent-API-Key header, Authorization header, or api_key query parameter'
      }
    };
  }

  try {
    const db = await getDbAsync();
    const agent = await db.select()
      .from(mcpAgents)
      .where(and(
        eq(mcpAgents.apiKey, apiKey),
        eq(mcpAgents.isActive, true)
      ))
      .limit(1);

    if (agent.length === 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'Invalid or inactive agent API key'
        }
      };
    }

    const agentData = agent[0];

    // Check rate limits
    const rateLimitCheck = await checkRateLimit(agentData.agentId, agentData.rateLimitRpm || 100, agentData.rateLimitOph || 10, isOrderOp);
    if (!rateLimitCheck.success) {
      return rateLimitCheck;
    }

    // Update last used timestamp
    await db.update(mcpAgents)
      .set({ lastUsed: new Date().toISOString() })
      .where(eq(mcpAgents.agentId, agentData.agentId));

    return {
      success: true,
      agentId: agentData.agentId
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

/**
 * Compute the (floored) minute/hour window boundaries used to bucket
 * mcp_rate_limits rows, as ISO strings.
 *
 * This is the single source of truth for how a timestamp maps to a rate
 * limit window key. It MUST be used by both the read path (checkRateLimit)
 * and the write path (updateRateLimit's caller) so a request is always
 * counted against the same row it was checked against — see BMC-142, where
 * the hour window was read with one derivation but never written at all.
 */
export function getRateLimitWindowStarts(now: Date = new Date()): { minuteStart: string; hourStart: string } {
  const minuteStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
  return {
    minuteStart: minuteStart.toISOString(),
    hourStart: hourStart.toISOString()
  };
}

export async function checkRateLimit(agentId: string, rpmLimit: number, ophLimit: number, isOrderOp = false): Promise<AgentAuthResult> {
  const { minuteStart, hourStart } = getRateLimitWindowStarts();

  try {
    const db = await getDbAsync();

    // Check minute rate limit — applies to every MCP operation.
    const minuteUsage = await db.select()
      .from(mcpRateLimits)
      .where(and(
        eq(mcpRateLimits.agentId, agentId),
        eq(mcpRateLimits.window, 'minute'),
        gte(mcpRateLimits.windowStart, minuteStart)
      ))
      .limit(1);

    if (minuteUsage.length > 0 && (minuteUsage[0]?.count || 0) >= rpmLimit) {
      return {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded: ${rpmLimit} requests per minute`
        }
      };
    }

    // Check hour rate limit for order-placement operations only (BMC-142
    // review). ophLimit defaults to 10, so applying this to every MCP call
    // (search, cart, sessions, etc.) instead of just order placement would
    // throttle all legitimate traffic to 10 calls/hour.
    if (isOrderOp) {
      const hourUsage = await db.select()
        .from(mcpRateLimits)
        .where(and(
          eq(mcpRateLimits.agentId, agentId),
          eq(mcpRateLimits.window, 'hour'),
          gte(mcpRateLimits.windowStart, hourStart)
        ))
        .limit(1);

      if (hourUsage.length > 0 && (hourUsage[0]?.count || 0) >= ophLimit) {
        return {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Rate limit exceeded: ${ophLimit} operations per hour`
          }
        };
      }
    }

    // Update rate limit counters. The minute counter is written on every
    // call. The hour counter is only written for order-placement operations
    // — it exists solely to cap order throughput (ophLimit), so writing it
    // on every call would both mis-enforce the cap on non-order traffic and
    // was the root cause of BMC-142 (unwritten, so the hour check never
    // tripped) before this scoping was added.
    await updateRateLimit(agentId, 'minute', minuteStart);
    if (isOrderOp) {
      await updateRateLimit(agentId, 'hour', hourStart);
    }

    return { success: true, agentId };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'RATE_LIMIT_ERROR',
        message: 'Failed to check rate limits',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

export async function updateRateLimit(agentId: string, window: string, windowStart: string): Promise<void> {
  const db = await getDbAsync();

  // Upsert rate limit record. The previous `where: eq(windowStart, windowStart)`
  // clause only allowed the UPDATE to apply when the row's STORED windowStart
  // already matched the incoming one — so once a row existed for (agentId,
  // window), its windowStart could never advance and the counter effectively
  // froze forever (BMC-142 review). Instead, always update, and use a CASE to
  // decide whether to increment (same window as before) or reset to 1 (the
  // window has rolled over since the row was last written).
  await db.insert(mcpRateLimits)
    .values({
      agentId,
      window,
      count: 1,
      windowStart
    })
    .onConflictDoUpdate({
      target: [mcpRateLimits.agentId, mcpRateLimits.window],
      set: {
        count: sql`CASE WHEN ${mcpRateLimits.windowStart} = ${windowStart} THEN ${mcpRateLimits.count} + 1 ELSE 1 END`,
        windowStart
      }
    });
}

export async function createAgent(agentData: {
  agentId: string;
  name: string;
  description?: string;
  permissions?: string[];
  rateLimitRpm?: number;
  rateLimitOph?: number;
}): Promise<{ apiKey: string }> {
  const db = await getDbAsync();
  const apiKey = generateApiKey();
  
  await db.insert(mcpAgents).values({
    agentId: agentData.agentId,
    name: agentData.name,
    description: agentData.description,
    apiKey,
    permissions: JSON.stringify(agentData.permissions || []),
    rateLimitRpm: agentData.rateLimitRpm || 100,
    rateLimitOph: agentData.rateLimitOph || 10,
    isActive: true
  });

  return { apiKey };
}

function generateApiKey(): string {
  return `mcp_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}