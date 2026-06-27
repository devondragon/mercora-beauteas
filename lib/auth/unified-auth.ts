import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isUserAdmin } from "../models/admin";
import { getApiTokenByHash, updateApiTokenLastUsed } from "../models/auth";

export interface AuthResult {
  success: boolean;
  response?: NextResponse;
  tokenInfo?: {
    id: number;
    tokenName: string;
    permissions: string[];
    lastUsedAt: string | null;
  };
}

/**
 * Standard permission sets for different API types
 */
export const PERMISSIONS = {
  // Vectorize operations
  VECTORIZE_READ: ["vectorize:read"],
  VECTORIZE_WRITE: ["vectorize:read", "vectorize:write"],
  
  // Order operations
  ORDERS_READ: ["orders:read"],
  ORDERS_WRITE: ["orders:read", "orders:write"],
  ORDERS_UPDATE: ["orders:read", "orders:write", "orders:update_status"],
  
  // Webhook operations
  WEBHOOKS_RECEIVE: ["webhooks:receive"],
  WEBHOOKS_CARRIER: ["webhooks:receive", "orders:update_tracking"],
  
  // Admin operations
  ADMIN_FULL: ["admin:*"],
};

/** Build a denial result with an HTTP response (callers do `return authResult.response!`). */
function deny(status: number, error: string): AuthResult {
  return { success: false, response: NextResponse.json({ error }, { status }) };
}

/** SHA-256 hex digest using Web Crypto (Workers-compatible). */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Does the granted permission set satisfy a single required permission? Supports wildcards. */
function grantsPermission(granted: string[], required: string): boolean {
  if (granted.includes("*") || granted.includes("admin:*")) return true;
  if (granted.includes(required)) return true;
  const [domain] = required.split(":");
  return granted.includes(`${domain}:*`);
}

/** Granted set must satisfy ALL required permissions. */
function hasAllPermissions(granted: string[], required: string[]): boolean {
  return required.every((r) => grantsPermission(granted, r));
}

/**
 * Extract a presented API token from headers only (Authorization: Bearer or X-API-Key).
 * Deliberately does NOT accept a `?token=` query param — these endpoints include refunds,
 * and tokens in URLs leak into server/proxy logs, browser history, and Referer headers.
 */
function extractToken(request: NextRequest): string | undefined {
  const header = request.headers.get("authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return request.headers.get("x-api-key") || undefined;
}

/**
 * Main authentication function.
 *
 * Accepts two credential types and fails closed (default deny) on anything else:
 *   1. API token  — for server-to-server/service calls. Either the ADMIN_VECTORIZE_TOKEN
 *      service secret, or an `api_tokens` row matched by SHA-256 hash with its own permissions.
 *   2. Clerk session — for the browser admin UI (which sends no token). An authenticated
 *      Clerk user is granted admin if `isUserAdmin()` or their Clerk metadata role is "admin".
 *
 * `requiredPermissions` are AND-combined; an empty array only requires valid credentials.
 */
export async function authenticateRequest(
  request: NextRequest,
  requiredPermissions: string[] = [],
  options: {
    updateLastUsed?: boolean;
    allowExpired?: boolean;
  } = {}
): Promise<AuthResult> {
  const { updateLastUsed = true, allowExpired = false } = options;

  try {
    // --- 1. API token authentication (service-to-service) ---
    const presentedToken = extractToken(request);
    if (presentedToken) {
      // Service shortcut: shared admin secret grants full admin (matches admin-middleware.ts).
      const serviceToken = process.env.ADMIN_VECTORIZE_TOKEN;
      if (serviceToken && presentedToken === serviceToken) {
        const permissions = ["admin:*"];
        if (!hasAllPermissions(permissions, requiredPermissions)) {
          return deny(403, "Insufficient permissions");
        }
        return {
          success: true,
          tokenInfo: {
            id: 0,
            tokenName: "admin-service",
            permissions,
            lastUsedAt: new Date().toISOString(),
          },
        };
      }

      // Database-backed API token (stored as a SHA-256 hash).
      const token = await getApiTokenByHash(await sha256Hex(presentedToken));
      if (!token) {
        return deny(401, "Invalid API token");
      }
      if (
        !allowExpired &&
        token.expiresAt &&
        new Date(token.expiresAt).getTime() < Date.now()
      ) {
        return deny(401, "API token expired");
      }
      const permissions: string[] = Array.isArray(token.permissions)
        ? (token.permissions as string[])
        : JSON.parse((token.permissions as unknown as string) || "[]");
      if (!hasAllPermissions(permissions, requiredPermissions)) {
        return deny(403, "Insufficient permissions");
      }
      if (updateLastUsed) {
        // Fire-and-forget: don't fail the request if the bookkeeping write fails.
        updateApiTokenLastUsed(token.id).catch((e) =>
          console.error("Failed to update token last-used:", e)
        );
      }
      return {
        success: true,
        tokenInfo: {
          id: token.id,
          tokenName: token.tokenName,
          permissions,
          lastUsedAt: token.lastUsedAt ?? null,
        },
      };
    }

    // --- 2. Clerk session authentication (browser admin UI) ---
    const { userId, sessionClaims } = await auth();
    if (userId) {
      const role = (sessionClaims as { metadata?: { role?: string } } | null)
        ?.metadata?.role;
      // Dev parity with admin-middleware.ts: any signed-in user is admin locally.
      // Never true in the deployed Worker (OpenNext sets NODE_ENV=production).
      const devAdmin = process.env.NODE_ENV === "development";
      const isAdmin = devAdmin || role === "admin" || (await isUserAdmin(userId));
      if (!isAdmin) {
        return deny(403, "Admin access required");
      }
      const permissions = ["admin:*"];
      if (!hasAllPermissions(permissions, requiredPermissions)) {
        return deny(403, "Insufficient permissions");
      }
      return {
        success: true,
        tokenInfo: {
          id: 0,
          tokenName: `clerk:${userId}`,
          permissions,
          lastUsedAt: new Date().toISOString(),
        },
      };
    }

    return deny(401, "Authentication required");
  } catch (error) {
    // Fail closed on any unexpected error.
    console.error("authenticateRequest error:", error);
    return deny(401, "Authentication failed");
  }
}

/**
 * Convenience function for auth middleware - also disabled
 */
export async function requireAuth(
  request: NextRequest,
  requiredPermissions: string[]
): Promise<NextResponse | null> {
  const authResult = await authenticateRequest(request, requiredPermissions);
  if (!authResult.success) {
    return authResult.response!;
  }
  return null;
}