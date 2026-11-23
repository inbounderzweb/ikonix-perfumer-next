import { getCategories, getCategoryProducts, getCollectionProducts } from "@/server/catalogue/queries";
import { BestSellers, HeroDesktop, HeroMobile, InstagramStrip, SpecialDeals, Testimonials } from "@/components/store/home/carousels";
import { BrandBanner, CollectionTiles, CustomFragrance, OfferMarquee, UspStrip } from "@/components/store/home/sections";

export const revalidate = 300; // catalogue changes appear within 5 minutes

export default async function HomePage() {
  // Tabs as on the legacy home: "Best Sellers" first, then each category; 8 products per tab.
  const [best, categories] = await Promise.all([getCollectionProducts("best-sellers", 8), getCategories()]);
  const perCategory = await Promise.all(categories.map(async (c) => ({ label: c.name, products: await getCategoryProducts(c.slug, 8) })));
  const tabs = [{ label: "Best Sellers", products: best }, ...perCategory].filter((t) => t.products.length > 0);

  return (
    <div>
      <section className="mx-auto mb-12 hidden w-[90%] flex-col gap-5 md:mt-10 md:flex lg:w-[80%]">
        <div className="overflow-hidden rounded-[18px]">
          <HeroDesktop />
          <OfferMarquee />
        </div>
        <CollectionTiles />
      </section>
      <section className="mt-6 w-full md:hidden">
        <HeroMobile />
        <div className="mx-auto w-[90%]"><OfferMarquee /></div>
        <div className="mt-3"><CollectionTiles /></div>
      </section>
      <div className="bg-[#F9F6F4]"><BestSellers tabs={tabs} /></div>
      <BrandBanner />
      <SpecialDeals />
      <CustomFragrance />
      <UspStrip />
      <InstagramStrip />
      <Testimonials />
    </div>
  );
}
