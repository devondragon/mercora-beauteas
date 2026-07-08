/**
 * Products API - MACH-compliant product management
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listProducts,
  createProduct,
  getProductsByCategory
} from "@/lib/models/mach/products";
import { toPublicProduct, toWireProduct } from "@/lib/models/mach/product-serializer";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import type { ApiResponse, Product } from "@/lib/types";

const PRODUCT_STATUSES = ['active', 'inactive', 'draft', 'archived'] as const;
type ProductStatus = (typeof PRODUCT_STATUSES)[number];

const isProductStatus = (value: string): value is ProductStatus =>
  (PRODUCT_STATUSES as readonly string[]).includes(value);

/** Parse an int query param defensively, clamping to [min, max] with a default. */
const clampInt = (raw: string | null, fallback: number, min: number, max: number): number => {
  const n = parseInt(raw ?? '', 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : fallback, min), max);
};

/**
 * GET /api/products - List products
 *
 * Public route (no auth required) — but only admins may request non-active
 * statuses. Non-admin callers are forced to status:['active'] regardless of
 * the `?status=` query param, and their response is projected through
 * toPublicProduct() to strip internal-only fields (cost/barcode/inventory).
 */
export async function GET(request: NextRequest) {
  try {
    // Not a 401 gate — GET stays public. This only determines whether the
    // caller may see non-active statuses / internal fields.
    const adminAuth = await checkAdminPermissions(request);
    const isAdmin = adminAuth.success;

    const url = new URL(request.url);
    const limit = clampInt(url.searchParams.get('limit'), 20, 1, 100);
    const offset = clampInt(url.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const requestedStatus = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    const category = url.searchParams.get('category');

    // Only admins may request non-active statuses, and the value must be valid.
    if (isAdmin && requestedStatus && !isProductStatus(requestedStatus)) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: [`Invalid status: ${requestedStatus}`]
        },
        { status: 400 }
      );
    }

    const statusFilter: ProductStatus[] | undefined = isAdmin
      ? (requestedStatus ? [requestedStatus as ProductStatus] : undefined)
      : ['active'];

    const filterByStatus = (list: Product[]): Product[] =>
      statusFilter ? list.filter(p => statusFilter.includes(p.status as ProductStatus)) : list;

    let total: number;
    let products: Product[];

    if (category && category.trim()) {
      // getProductsByCategory isn't status-/pagination-aware, so fetch once,
      // apply the status filter, then slice for the page. total/links derive
      // from the full filtered list so pagination stays consistent.
      const filtered = filterByStatus(await getProductsByCategory(category.trim()));
      total = filtered.length;
      products = filtered.slice(offset, offset + limit);
    } else {
      const [all, page] = await Promise.all([
        listProducts({ status: statusFilter }),
        listProducts({ status: statusFilter, limit, offset })
      ]);
      total = all.length;
      products = page;
    }

    // BMC-164: emit MACH wire-shaped money ({amount, currency, precision} in
    // major units) at this API boundary — internal storage stays cents.
    const responseProducts = (isAdmin ? products : products.map(toPublicProduct)).map(toWireProduct);

    const response: ApiResponse<Product[]> = {
      data: responseProducts,
      meta: {
        total,
        limit,
        offset,
        schema: "mach:product"
      },
      links: {
        self: `/api/products?limit=${limit}&offset=${offset}`,
        first: `/api/products?limit=${limit}&offset=0`,
        ...(offset + limit < total && {
          next: `/api/products?limit=${limit}&offset=${offset + limit}`
        }),
        ...(offset > 0 && {
          prev: `/api/products?limit=${limit}&offset=${Math.max(0, offset - limit)}`
        }),
        last: `/api/products?limit=${limit}&offset=${Math.floor(total / limit) * limit}`
      }
    };
    return NextResponse.json(response);

  } catch (error) {
    console.error('Products API error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve products' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/products - Create product
 */
export async function POST(request: NextRequest) {
  const adminAuth = await checkAdminPermissions(request);
  if (!adminAuth.success) {
    return NextResponse.json({ error: adminAuth.error }, { status: 401 });
  }

  try {
    const body = await request.json() as any;
    
    if (!body.name) {
      return NextResponse.json({
        error: 'Validation failed',
        details: ['name is required']
      }, { status: 400 });
    }
    // Optionally, add more MACH spec validation here
  const product = await createProduct(body as Product);
    const response: ApiResponse<Product> = {
      data: toWireProduct(product),
      meta: {
        schema: "mach:product"
      }
    };
    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    console.error('Products API error:', error);
    
    if (error instanceof Error) {
      return NextResponse.json({
        error: 'Validation failed',
        message: error.message
      }, { status: 400 });
    }
    
    return NextResponse.json(
      { error: 'Failed to create product' },
      { status: 500 }
    );
  }
}
