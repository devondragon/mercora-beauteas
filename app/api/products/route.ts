/**
 * Products API - MACH-compliant product management
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listProducts,
  createProduct,
  getProductsByCategory
} from "@/lib/models/mach/products";
import { toPublicProduct } from "@/lib/models/mach/product-serializer";
import { checkAdminPermissions } from "@/lib/auth/admin-middleware";
import type { ApiResponse, Product } from "@/lib/types";

type ProductStatus = 'active' | 'inactive' | 'draft' | 'archived';

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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const requestedStatus = url.searchParams.get('status') as ProductStatus | null;
    const search = url.searchParams.get('search');
    const category = url.searchParams.get('category');

    const statusFilter: ProductStatus[] | undefined = isAdmin
      ? (requestedStatus ? [requestedStatus] : undefined)
      : ['active'];

    const filterByStatus = (list: Product[]): Product[] =>
      statusFilter ? list.filter(p => statusFilter.includes(p.status as ProductStatus)) : list;

    // Get total count first (without limit/offset)
    const allProducts = category && category.trim()
      ? filterByStatus(await getProductsByCategory(category.trim()))
      : await listProducts({
          status: statusFilter
        });
    const total = allProducts.length;

    // Then get the paginated results
    const products = category && category.trim()
      ? filterByStatus(await getProductsByCategory(category.trim()))
      : await listProducts({
          status: statusFilter,
          limit,
          offset
        });

    const responseProducts = isAdmin ? products : products.map(toPublicProduct);

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
      data: product,
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
