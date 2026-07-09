/**
 * === Recommendations Rebuild API ===
 * Precomputes per-product recommendation lists (AI-batch provider) from the
 * Vectorize index. Admin-authenticated. Mirrors /api/admin/vectorize.
 *
 * POST /api/admin/recommendations/rebuild
 *   Auth: Authorization: Bearer <token> | X-API-Key: <token> | Clerk admin session
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import { rebuildProductRecommendations } from "@/lib/recommendations/batch/rebuild";

export async function POST(request: NextRequest) {
  try {
    const authResult = await checkAdminPermissions(request);
    if (!authResult.success) {
      return NextResponse.json(
        { error: authResult.error || "Admin access required" },
        { status: 401 }
      );
    }

    const { env } = await getCloudflareContext({ async: true });
    const startTime = Date.now();
    const summary = await rebuildProductRecommendations(env);

    return NextResponse.json({
      success: true,
      ...summary,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    console.error("Recommendations rebuild error:", error);
    return NextResponse.json(
      { error: "Failed to rebuild recommendations", detail: String(error) },
      { status: 500 }
    );
  }
}
