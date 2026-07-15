import { NextRequest } from 'next/server';
import { getDbAsync } from '../db';
import { mcpAgents, mcpRateLimits } from '../db/schema/mcp';
import { eq, and, gte, sql } from 'drizzle-orm';
import { MCPError } from './types';
import { AuthenticationError, RateLimitError, DatabaseError } from './error-handler';
import { sha256Hex } from '../auth/crypto';

export interface AgentAuthResult {
  success: boolean;
  agentId?: string;
  /** The authenticated agent's granted permissions (parsed from mcpAgents.permissions). */
  permissions?: string[];
  error?: MCPError['error'];
}

/**
 * Permissions that grant access to the agent-management tier (create/list/
 * inspect/disable other agents). Agent management must be restricted to
 * privileged agents — a plain commerce agent must not be able to enumerate
 * or modify the agent fleet or read other agents' session ids (BMC-133, C7/C8).
 *
 * Bootstrap: the first management-capable agent must be seeded with one of
 * these permissions directly (DB / scripts/manage-tokens), since the create
 * route is now itself gated.
 */
const AGENT_MANAGEMENT_PERMISSIONS = ['admin', '*', 'agents:manage'];

export function hasAgentManagementPermission(permissions: string[] | undefined): boolean {
  if (!permissions) return false;
  return permissions.some((p) => AGENT_MANAGEMENT_PERMISSIONS.includes(p));
}

/**
 * Superuser grants — a key holding either satisfies ANY scope check below.
 * `admin` and `*` are the same wildcard grants recognized by the
 * agent-management tier, kept here so commerce and management scoping agree on
 * what "unrestricted" means.
 */
const SUPERUSER_PERMISSIONS = ['admin', '*'];

/**
 * Commerce permission scopes (BMC-188). The per-agent `permissions` array was
 * previously only consulted for the agent-management tier, so a key provisioned
 * `["read:products"]` — or `[]` — could still mutate carts and spend money. The
 * commerce tools now require the matching scope below (fail closed):
 *   - write:cart   → cart-mutating tools (add/update/remove/bulk-add/clear)
 *   - place:orders → order + payment placement (place_order, create_payment_intent)
 * `admin`/`*` (SUPERUSER_PERMISSIONS) satisfy either.
 */
export const COMMERCE_SCOPES = {
  WRITE_CART: 'write:cart',
  PLACE_ORDERS: 'place:orders',
} as const;

/**
 * True when the agent's granted permissions include `required`, or hold a
 * superuser grant (`admin`/`*`). Fails closed for undefined/empty permissions.
 * This is the single mechanism the commerce tools and the dispatcher use to
 * gate scoped operations.
 */
export function hasPermission(permissions: string[] | undefined, required: string): boolean {
  if (!permissions) return false;
  return permissions.some((p) => p === required || SUPERUSER_PERMISSIONS.includes(p));
}

/**
 * Maps a dispatchable MCP tool name to the commerce scope it requires. Tools
 * absent from this map carry no commerce-scope requirement (read-only/catalog
 * tools and the separately-gated agent-management tier). Used by the JSON
 * dispatcher (POST /api/mcp) and mirrored on the REST /tools/* routes.
 */
export const COMMERCE_TOOL_SCOPES: Record<string, string> = {
  add_to_cart: COMMERCE_SCOPES.WRITE_CART,
  update_cart: COMMERCE_SCOPES.WRITE_CART,
  remove_from_cart: COMMERCE_SCOPES.WRITE_CART,
  bulk_add_to_cart: COMMERCE_SCOPES.WRITE_CART,
  clear_cart: COMMERCE_SCOPES.WRITE_CART,
  place_order: COMMERCE_SCOPES.PLACE_ORDERS,
  create_payment_intent: COMMERCE_SCOPES.PLACE_ORDERS,
};

/**
 * Returns the commerce scope a tool requires, or `undefined` for tools that
 * carry no commerce-scope requirement. This is the single lookup both the JSON
 * dispatcher and the REST /tools/* routes use, so the REST routes derive their
 * required scope from `COMMERCE_TOOL_SCOPES` (the source of truth) rather than
 * hardcoding it inline — adding a future commerce tool only means updating the
 * map above (BMC-188 review).
 */
export function requiredScopeForTool(toolName: string): string | undefined {
  return COMMERCE_TOOL_SCOPES[toolName];
}

export async function authenticateAgent(
  request: NextRequest,
  opts: { isOrderOp?: boolean } = {}
): Promise<AgentAuthResult> {
  const { isOrderOp = false } = opts;
  // Header-only (BMC-188): a key must arrive in a request header, never the
  // query string. `?api_key=` leaks the credential into CF/access logs, the
  // Referer header, and browser history — it was dropped to match the project's
  // header-only auth standard (the same rule unified-auth enforces for
  // api_tokens).
  const apiKey = request.headers.get('X-Agent-API-Key') ||
                 request.headers.get('Authorization')?.replace('Bearer ', '');

  if (!apiKey) {
    return {
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: 'Agent API key required in X-Agent-API-Key or Authorization header'
      }
    };
  }

  try {
    const db = await getDbAsync();
    // Look the agent up by the SHA-256 hash of the presented key rather than the
    // raw key (BMC-141). The DB stores only the hash, so a D1 read never exposes
    // usable credentials. Matching on the fixed-length hash via an indexed
    // equality lookup also removes the plaintext-compare timing concern (BMC-155)
    // — the same approach getApiTokenByHash() uses for api_tokens.
    const apiKeyHash = await sha256Hex(apiKey);
    const agent = await db.select()
      .from(mcpAgents)
      .where(and(
        eq(mcpAgents.apiKeyHash, apiKeyHash),
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

    let permissions: string[] = [];
    try {
      const parsed = JSON.parse(agentData.permissions || '[]');
      if (Array.isArray(parsed)) {
        permissions = parsed.filter((p): p is string => typeof p === 'string');
      }
    } catch {
      // Malformed permissions column: fail closed to no permissions rather
      // than throwing — the agent authenticates but is treated as unprivileged.
      permissions = [];
    }

    return {
      success: true,
      agentId: agentData.agentId,
      permissions
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
    //
    // Both increments are issued in a single db.batch([...]) so they commit
    // atomically: previously they were two sequential awaited writes, so if
    // the hour write threw after the minute write committed the counters could
    // drift while the caller still received a RATE_LIMIT_ERROR. D1 has no
    // db.transaction(); db.batch() is the atomic multi-statement primitive.
    //
    // NOTE (residual TOCTOU): the hour hard-cap is still read (above) then
    // written here as separate steps, so two concurrent order requests can both
    // pass the pre-read gate before either increments and momentarily exceed
    // ophLimit. A fully atomic conditional compare-and-increment was not
    // adopted here because the existing pre-read gate must leave a blocked
    // request's counter untouched (see rate-limit integration tests), which an
    // increment-then-check scheme would violate. The cap is therefore enforced
    // best-effort; the batch below only guarantees the two writes commit
    // together, not that the cap can never be raced by a hair.
    if (isOrderOp) {
      await db.batch([
        buildRateLimitUpsert(db, agentId, 'minute', minuteStart),
        buildRateLimitUpsert(db, agentId, 'hour', hourStart)
      ]);
    } else {
      await db.batch([
        buildRateLimitUpsert(db, agentId, 'minute', minuteStart)
      ]);
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

/**
 * Build (but do not execute) the upsert that increments a rate-limit window
 * counter. Returned unawaited so it can either be awaited on its own (see
 * updateRateLimit) or handed to db.batch([...]) to commit atomically alongside
 * a sibling window write (see checkRateLimit).
 *
 * Upsert semantics: the previous `where: eq(windowStart, windowStart)` clause
 * only allowed the UPDATE to apply when the row's STORED windowStart already
 * matched the incoming one — so once a row existed for (agentId, window), its
 * windowStart could never advance and the counter effectively froze forever
 * (BMC-142 review). Instead, always update, and use a CASE to decide whether to
 * increment (same window as before) or reset to 1 (the window has rolled over
 * since the row was last written).
 */
function buildRateLimitUpsert(
  db: Awaited<ReturnType<typeof getDbAsync>>,
  agentId: string,
  window: string,
  windowStart: string
) {
  return db.insert(mcpRateLimits)
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

export async function updateRateLimit(agentId: string, window: string, windowStart: string): Promise<void> {
  const db = await getDbAsync();
  await buildRateLimitUpsert(db, agentId, window, windowStart);
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
  // Persist only the hash; the raw key is returned to the caller once and is
  // never stored or recoverable afterward (BMC-141).
  const apiKeyHash = await sha256Hex(apiKey);

  await db.insert(mcpAgents).values({
    agentId: agentData.agentId,
    name: agentData.name,
    description: agentData.description,
    apiKeyHash,
    permissions: JSON.stringify(agentData.permissions || []),
    rateLimitRpm: agentData.rateLimitRpm || 100,
    rateLimitOph: agentData.rateLimitOph || 10,
    isActive: true
  });

  return { apiKey };
}

// BMC-147: Date.now() + Math.random() is not a CSPRNG and is predictable
// (narrow, time-seeded search space). crypto.randomUUID() is Web Crypto —
// available as a global in the Workers runtime, Node 20+, and jsdom — and
// gives >=122 bits of cryptographically secure entropy.
export function generateApiKey(): string {
  return `mcp_${crypto.randomUUID().replace(/-/g, '')}`;
}