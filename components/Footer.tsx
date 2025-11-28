import Link from "next/link";
import { getNavigationPages } from "@/lib/models/pages";
import { getSocialMediaSettings } from "@/lib/utils/settings";

export default async function Footer() {
  const [navigationPages, socialMedia] = await Promise.all([
    getNavigationPages(),
    getSocialMediaSettings()
  ]);

  return (
    <footer className="bg-charcoal text-cream-100 mt-16 relative z-10">
      <div className="ml-0 sm:ml-[100px] lg:ml-[200px] px-4 sm:px-6 py-12 sm:py-16 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 sm:gap-8 text-sm text-cream-300 z-10 relative">
        <div className="space-y-2">
          {/* Navigation Pages from CMS */}
          {navigationPages.map((page) => (
            <Link
              key={page.id}
              href={`/${page.slug}`}
              className="block hover:text-blush-300"
            >
              {page.nav_title || page.title}
            </Link>
          ))}
        </div>
        <div className="space-y-2">
          <a href="#" className="block hover:text-blush-300">Contact us</a>
          <a href="#" className="block hover:text-blush-300">Keep in touch</a>
        </div>
        <div className="space-y-2">
          <a href="#" className="block hover:text-blush-300">Blog</a>
          <a href="#" className="block hover:text-blush-300">Brewing Directions</a>
        </div>
        <div className="space-y-2">
          {/* Social Media Links from Settings */}
          {socialMedia.instagram && (
            <a
              href={socialMedia.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:text-blush-300"
            >
              Instagram
            </a>
          )}
          {socialMedia.facebook && (
            <a
              href={socialMedia.facebook}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:text-blush-300"
            >
              Facebook
            </a>
          )}
          {socialMedia.pinterest && (
            <a
              href={socialMedia.pinterest}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:text-blush-300"
            >
              Pinterest
            </a>
          )}
          {socialMedia.linkedin && (
            <a
              href={socialMedia.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="block hover:text-blush-300"
            >
              LinkedIn
            </a>
          )}
        </div>
      </div>
      <div className="text-center text-xs text-cream-400 pb-4 pt-2 relative z-10">
        ©2025 BeauTeas. All rights reserved.
      </div>
      <div className="absolute bottom-0 left-[10px] sm:left-[20px] text-[60px] sm:text-[100px] lg:text-[140px] font-serif font-bold text-charcoal-light/20 leading-none z-0 select-none">
        BeauTeas
      </div>
    </footer>
  );
}
