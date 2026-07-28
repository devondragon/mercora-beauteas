/**
 * Tinted hero band shown at the top of every CMS page. Uniform across
 * templates so the pages read as one set — the eyebrow is the only part that
 * varies, and it comes from the template config.
 */
interface PageHeroProps {
  eyebrow: string;
  title: string;
  lede: string | null;
}

export default function PageHero({ eyebrow, title, lede }: PageHeroProps) {
  return (
    <div className="bg-gradient-to-br from-[#f9e6e0] to-[#f5ecdb] border-b border-secondary-400/35">
      <div className="max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-secondary-700">
          {eyebrow}
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl md:text-[46px] font-semibold tracking-tight leading-[1.08] text-[#3a231e] mt-3 mb-3">
          {title}
        </h1>
        {lede && (
          <p className="text-lg sm:text-xl leading-relaxed text-[#6a4a42] max-w-[58ch]">
            {lede}
          </p>
        )}
      </div>
    </div>
  );
}
