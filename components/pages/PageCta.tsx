import Link from "next/link";
import { POLICY_LINKS, type PageCtaConfig } from "@/lib/cms/page-template";

/**
 * Closing band. Every page ends with a next step rather than trailing off into
 * whitespace — legal pages additionally surface their sibling policies.
 */
interface PageCtaProps {
  config: PageCtaConfig;
}

export default function PageCta({ config }: PageCtaProps) {
  return (
    <div className="bg-gradient-to-br from-[#f7e3dc] to-[#f3ead9] border-t border-secondary-400/35 mt-4">
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12 text-center">
        <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-[#3a231e] mb-2">
          {config.heading}
        </h2>
        {config.body && <p className="text-base sm:text-lg text-[#6a4a42] mb-6">{config.body}</p>}
        <div className="flex flex-wrap gap-3 justify-center">
          {config.actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={
                action.variant === "primary"
                  ? "px-6 py-2.5 rounded-lg bg-primary-500 text-text-inverse hover:bg-primary-600 transition-colors"
                  : "px-6 py-2.5 rounded-lg border border-primary-400 text-primary-700 hover:bg-primary-400 hover:text-text-inverse transition-colors"
              }
            >
              {action.label}
            </Link>
          ))}
        </div>
        {config.showPolicyLinks && (
          <div className="flex flex-wrap gap-2 justify-center mt-6">
            {POLICY_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[13.5px] px-3 py-1.5 rounded-full bg-white/60 border border-secondary-400/45 text-secondary-700 hover:bg-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
