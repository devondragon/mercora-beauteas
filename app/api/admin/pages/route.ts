/**
 * Admin Pages API - Content Management System
 * 
 * Handles CRUD operations for pages in the admin interface.
 * Protected by admin authentication middleware.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkAdminPermissions, isSuperAdminActor } from "@/lib/auth/admin-middleware";
import { customJsChanged, isNonEmptyScript, logCustomJsAudit } from "@/lib/cms/custom-js-guard";
import {
  getPages,
  createPage,
  getPageStats,
  searchPages,
  PAGE_STATUS
} from "@/lib/models/pages";

/**
 * GET /api/admin/pages - Get all pages with admin access
 */
export async function GET(request: NextRequest) {
  // Check admin permissions
  const authResult = await checkAdminPermissions(request);
  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');
    const statsOnly = searchParams.get('stats') === 'true';

    // Return stats only if requested
    if (statsOnly) {
      const stats = await getPageStats();
      return NextResponse.json({
        success: true,
        data: stats
      });
    }

    // Handle search
    if (search) {
      const results = await searchPages(search, {
        includeUnpublished: true,
        limit: limit ? parseInt(limit) : undefined
      });
      return NextResponse.json({
        success: true,
        data: results
      });
    }

    // Get pages with filters
    const options: any = {
      includeProtected: true, // Admin can see protected pages
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined
    };

    if (status && Object.values(PAGE_STATUS).includes(status as any)) {
      options.status = status;
    }

    const pages = await getPages(options);

    return NextResponse.json({
      success: true,
      data: pages
    });

  } catch (error) {
    console.error("Error fetching pages:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch pages" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/pages - Create a new page
 */
export async function POST(request: NextRequest) {
  // Check admin permissions
  const authResult = await checkAdminPermissions(request);
  if (!authResult.success) {
    return NextResponse.json(
      { success: false, error: authResult.error },
      { status: 401 }
    );
  }

  try {
    const data = await request.json() as Record<string, any>;

    // Guardrail (BMC-163): only a super-admin may set arbitrary client-side
    // `custom_js` to a NON-EMPTY value. Removing/clearing it is allowed for any
    // admin. `customJsChanged(data, null)` is true only for a non-empty create
    // here (there is no existing value to clear), but we gate explicitly on
    // `isNonEmptyScript` to keep the intent obvious and consistent with PUT.
    const customJsWrite = customJsChanged(data, null);
    if (customJsWrite && isNonEmptyScript(data.custom_js)) {
      const allowed = await isSuperAdminActor(authResult);
      if (!allowed) {
        // Rejected attempt — audit before returning (no write happens).
        logCustomJsAudit({
          actorUserId: authResult.userId,
          pageSlug: typeof data.slug === "string" ? data.slug : undefined,
          action: "create",
          allowed: false,
        });
        return NextResponse.json(
          { success: false, error: "Only a super-admin may set custom JavaScript on a page." },
          { status: 403 }
        );
      }
    }

    // Add creator information
    const pageData = {
      ...data,
      created_by: authResult.userId,
      updated_by: authResult.userId
    };

    const newPage = await createPage(pageData as any);

    // Audit the custom_js write only AFTER it has actually persisted, so an
    // `allowed: true` record always corresponds to a committed change.
    if (customJsWrite) {
      logCustomJsAudit({
        actorUserId: authResult.userId,
        pageId: newPage.id,
        pageSlug: newPage.slug,
        action: "create",
        allowed: true,
      });
    }

    return NextResponse.json({
      success: true,
      data: newPage,
      message: "Page created successfully"
    }, { status: 201 });

  } catch (error) {
    console.error("Error creating page:", error);
    
    // Handle validation errors
    if (error instanceof Error && error.message.includes("Invalid page data")) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to create page" },
      { status: 500 }
    );
  }
}