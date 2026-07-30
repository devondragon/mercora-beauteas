import Link from "next/link";
import Image from "next/image";
import { getNavigationPages } from "@/lib/models/pages";
import { getSocialMediaSettings } from "@/lib/utils/settings";
import { brand } from "@/lib/brand";

type FooterLink = { label: string; href: string; external?: boolean };

/**
 * Column count is driven by how many columns actually have links — an empty
 * column (e.g. no social accounts configured) would otherwise still claim its
 * grid track and push the real links off to one side.
 *
 * These class strings must stay literal: Tailwind scans source text, so a
 * computed `lg:grid-cols-${n}` would never be generated.
 */
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

export default async function Footer() {
  const [navigationPages, socialMedia] = await Promise.all([
    getNavigationPages(),
    getSocialMediaSettings()
  ]);

  const curatedHrefs = new Set<string>(
    [...brand.footerLinks.column2, ...brand.footerLinks.column3].map((l) => l.href)
  );
  const primaryNavPages = navigationPages.filter(
    (page) => !curatedHrefs.has(`/${page.slug}`)
  );

  const socialLinks: FooterLink[] = (
    [
      ["Instagram", socialMedia.instagram],
      ["YouTube", socialMedia.youtube],
      ["LinkedIn", socialMedia.linkedin],
      ["Twitter", socialMedia.twitter],
      ["Facebook", socialMedia.facebook],
      ["TikTok", socialMedia.tiktok],
    ] as const
  )
    .filter(([, href]) => Boolean(href))
    .map(([label, href]) => ({ label, href, external: true }));

  // Curated columns first, then CMS pages (legal), then social — anything empty
  // is dropped so the remaining columns stay evenly distributed.
  const columns: FooterLink[][] = [
    brand.footerLinks.column2.map((l) => ({ label: l.label, href: l.href })),
    brand.footerLinks.column3.map((l) => ({ label: l.label, href: l.href })),
    primaryNavPages.map((page) => ({
      label: page.nav_title || page.title,
      href: `/${page.slug}`,
    })),
    socialLinks,
  ].filter((column) => column.length > 0);

  return (
    <footer className="bg-surface text-text-primary mt-16 relative z-10">
      {/* Padding outside the max-width, matching the page content wrapper
          (main: px-4 sm:px-6 lg:px-12 > .max-w-6xl) so footer links line up
          with the product grid rather than sitting 24px inboard of it. */}
      <div className="px-4 sm:px-6 lg:px-12 py-12 sm:py-16 relative z-10">
        <div
          className={`max-w-6xl mx-auto grid ${GRID_COLS[columns.length] ?? GRID_COLS[4]} gap-6 sm:gap-8 text-sm text-text-secondary`}
        >
          {columns.map((column, index) => (
            <div key={index} className="space-y-2">
              {column.map((link) =>
                link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block hover:text-text-primary transition-colors"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="block hover:text-text-primary transition-colors"
                  >
                    {link.label}
                  </Link>
                )
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="text-center text-xs text-text-muted pb-4 pt-2 relative z-10">
        {brand.copyright}
      </div>
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-0 select-none pointer-events-none opacity-[0.08]">
        <Image
          src="/logo.png"
          alt=""
          aria-hidden
          width={692}
          height={120}
          className="h-[60px] sm:h-[100px] lg:h-[140px] w-auto"
        />
      </div>
    </footer>
  );
}
