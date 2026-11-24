import Image from "next/image";
import Link from "next/link";

const S = "/ikonix/site";
// Raster versions of the design-export SVGs (see scripts/ikonix/rasterize-site-svgs.ts): the SVGs embed
// multi-megabyte photos that cannot be resized or lazy-loaded efficiently.
const R = `${S}/raster`;

// Legacy Um: scrolling offer strip. The text promises member-only offers; it is the legacy copy.
const OFFER = "EXCLUSIVE OFFERS AVAILABLE ONLY TO LOGGED-IN USERS. LOG IN NOW TO UNLOCK!";
export function OfferMarquee() {
  return (
    <div className="group w-full overflow-hidden bg-[#2d3545] py-2 text-white md:py-2.5" role="region" aria-label="Current offers">
      <div className="offer-marquee-track flex w-max whitespace-nowrap">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className="mx-6 font-fancy text-[12px] font-medium tracking-wide md:mx-10 md:text-[14px]">
                {OFFER}<span className="ml-6 text-[#DDB849] md:ml-10">✦</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Legacy Vm: three collection tiles (custom fragrance → contact, women, men).
const TILES = [
  { src: `${R}/info.webp`, href: "/contact", label: "Create your custom fragrance" },
  { src: `${R}/info1.webp`, href: "/shop?cat=womens", label: "Women’s collection" },
  { src: `${R}/info2.webp`, href: "/shop?cat=mens", label: "Men’s collection" },
];
export function CollectionTiles() {
  return (
    <div className="mx-auto w-[90%] md:w-full">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-5">
        {TILES.map((t) => (
          <Link key={t.src} href={t.href} aria-label={t.label} className="w-full overflow-hidden rounded-[6px] transition-all duration-300 hover:shadow-lg md:rounded-[8px]">
            <Image src={t.src} alt={t.label} width={1080} height={420} sizes="(min-width:1024px) 27vw, (min-width:768px) 30vw, 90vw" className="block h-auto w-full" />
          </Link>
        ))}
      </div>
    </div>
  );
}

export function BrandBanner() {
  return (
    <section className="w-full">
      {/* Both stay lazy: a lazy image hidden by CSS is never fetched, so each device downloads only its own banner. */}
      <Image src={`${R}/BrandShowcaseBanner.webp`} alt="Ikonix Perfumer brand banner" width={2880} height={720} sizes="100vw" className="hidden h-auto w-full object-cover md:block" />
      <Image src={`${R}/BrandShowcaseBanner_mobile.webp`} alt="Ikonix Perfumer brand banner" width={1086} height={1448} sizes="100vw" className="block h-auto w-full object-cover md:hidden" />
    </section>
  );
}

export function CustomFragrance() {
  return (
    <section>
      <div className="mx-auto w-[90%] py-16 lg:w-[80%]">
        <div className="mx-auto flex max-w-[960px] flex-col items-center gap-8 md:flex-row md:gap-10">
          <div className="w-full shrink-0 overflow-hidden rounded-2xl md:w-[440px]">
            <Image src={`${R}/makeperfume.webp`} alt="Perfumer crafting fragrance" width={1000} height={632} sizes="(min-width:768px) 440px, 90vw" className="h-auto w-full object-cover" />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 md:items-start">
            <h2 className="text-center font-heading text-3xl font-medium text-[#7c706c] md:text-left md:text-[34px]">Create Your Own <br />Signature Perfume</h2>
            <p className="max-w-prose text-center font-fancy text-[#7c706c] md:text-left">
              Design a custom luxury fragrance crafted exclusively for you. At Ikonix Perfumer, we blend premium ingredients, rare aroma notes, and expert craftsmanship to create a scent that reflects your personality. From fresh citrus accords to deep woody undertones, experience bespoke perfumery tailored to your style.
            </p>
            <Link href="/contact" className="mt-2 w-max rounded-full bg-[#dab6a7] px-5 py-3 font-fancy text-base font-medium text-[#44403c] transition hover:bg-[#e2c4b8]">Start Your Custom Fragrance</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const USPS = [
  { icon: `${S}/uspi1.png`, title: "Finest Imported Ingredients", copy: "We source high-quality essential oils and rare fragrance extracts from around the world to ensure long-lasting, luxurious perfumes with exceptional depth and character." },
  { icon: `${S}/uspi3.png`, title: "Artisan Perfume Blending", copy: "Our master perfumers carefully craft each fragrance using precise blending techniques to create balanced, refined, and unforgettable scent compositions." },
  { icon: `${S}/usp-all-day-lasting.png`, title: "All-Day Lasting Fragrance", copy: "Experience powerful, long-lasting perfumes designed to stay vibrant from morning to night without fading, ensuring confidence in every moment." },
];
export function UspStrip() {
  return (
    <div className="w-full bg-[#e8d5cf]">
      <section className="mx-auto grid w-[90%] justify-stretch gap-2 py-4 md:w-[90%] md:justify-center md:gap-0 md:justify-center md:p-4 lg:w-[80%] xl:flex xl:space-x-10">
        {USPS.map((u) => (
          <div key={u.title} className="mx-0 my-1.5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-3 rounded-2xl border border-[#c9ada0] bg-[#f3e6e1] p-4 shadow-sm md:m-[10px] md:rounded-none md:border-0 md:bg-transparent md:p-2 md:shadow-none md:border-[#B39384] md:last:border-b-0 md:flex md:gap-0 md:space-x-6 md:border-r md:border-b-0 md:py-4 md:pr-10 md:last:border-r-0 md:last:pr-0 xl:flex-1">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-[#b39384] md:h-24 md:w-24">
              <Image src={u.icon} alt="" width={48} height={48} className="w-8 object-contain md:w-12" />
            </div>
            <div className="contents text-left md:block">
              <span className="block font-fancy text-xl font-bold leading-7">{u.title}</span>
              <p className="col-span-2 font-fancy text-sm text-gray-700 md:col-span-1 md:mt-2">{u.copy}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// About page blocks (legacy Lm) — reused there.
export const WHY_CHOOSE = [
  { icon: `${S}/ch1.svg`, title: "Personalised Fragrances", text: "We create scents that are all about your preferences." },
  { icon: `${S}/ch2.svg`, title: "Scent Recreation", text: "We recreate popular favourites for you, making them more accessible without compromising on quality." },
  { icon: `${S}/ch3.svg`, title: "High-Quality Ingredients", text: "We use safe, premium ingredients that last long and are gentle on your skin." },
  { icon: `${S}/why-affordable-pricing.png`, title: "Affordable Pricing", text: "We offer custom blends and recreated favourites at prices that make sense." },
  { icon: `${S}/ch5.svg`, title: "Expert Craftsmanship", text: "Our perfumers, with years of experience in the industry, ensure every fragrance is carefully balanced and thoughtfully made." },
];
