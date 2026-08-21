"use client";

import Image from "next/image";
import Link from "next/link";
import { stateStyles } from "@/lib/ui/state-styles";
import { Money } from "@/lib/money";
import { resolveProductImageSrc } from "@/lib/utils/product-image";

export default function ProductCard({ product }: { product: any }) {
  // Accepts both stored shapes — flat ({url}) from the ETL and MACH
  // ({file:{url}}) from the admin editor. Reading only `.url` here made Chai's
  // product cards fall back to the placeholder for any product that had been
  // saved through /admin/products. See lib/utils/product-image.ts.
  const imageUrl = resolveProductImageSrc(product.primary_image, product.media);

  // Get price from first variant (amount is integer minor units)
  const variant = product.variants?.[0];
  const price = variant?.price?.amount || 0;
  const currency = variant?.price?.currency || "USD";
  const compareAtPrice = variant?.compare_at_price?.amount;
  const isOnSale = compareAtPrice && compareAtPrice > price;

  // Get description from the new structure
  const description = typeof product.description === 'string' ? 
    product.description : 
    (product.description?.en || '');

  return (
    <div className="border rounded-md p-2 bg-white shadow-sm hover:shadow-md transition-shadow">
      <Link href={`/product/${product.slug}`} className="flex items-center space-x-2" prefetch={true}>
        {/* Smaller image for drawer */}
        <div className="w-12 h-12 relative flex-shrink-0 overflow-hidden rounded border">
          <Image
            src={imageUrl}
            alt={product.name || 'Product'}
            fill
            sizes="48px"
            className="object-cover"
          />
        </div>
        <div className="flex-1 min-w-0">
          {/* Smaller, more compact text */}
          <h4 className="text-xs font-semibold truncate text-text-primary">{product.name}</h4>
          <p className="text-xs text-text-muted truncate">
            {description.length > 60 ? description.substring(0, 60) + '...' : description}
          </p>
          {isOnSale ? (
            <p className="text-xs mt-0.5">
              <span className={`${stateStyles.priceOriginal} mr-1`}>
                {Money.fromMinor(compareAtPrice, currency).format()}
              </span>
              <span className={stateStyles.priceSale}>{Money.fromMinor(price, currency).format()}</span>
            </p>
          ) : (
            <p className="text-xs font-medium text-text-primary mt-0.5">
              {Money.fromMinor(price, currency).format()}
            </p>
          )}
        </div>
      </Link>
    </div>
  );
}
