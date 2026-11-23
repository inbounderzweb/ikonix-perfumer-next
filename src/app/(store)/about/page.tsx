import type { Metadata } from "next";
import Image from "next/image";
import { Breadcrumb } from "@/components/store/breadcrumb";
import { SpecialDeals } from "@/components/store/home/carousels";
import { CustomFragrance, WHY_CHOOSE } from "@/components/store/home/sections";

export const metadata: Metadata = {
  title: "About Us",
  description: "Ikonix is built around one simple idea — scent should be personal. Custom fragrances and recreations of popular favourites, crafted by experienced perfumers.",
  alternates: { canonical: "/about" },
};

const S = "/ikonix/site";
const MISSION = [
  { icon: `${S}/mission.svg`, title: "Our Mission", text: "To create high-quality, personalised fragrances that express individual style, evoke emotion, and make luxury scent experiences accessible to everyone." },
  { icon: `${S}/vision.svg`, title: "Our Vision", text: "To become a trusted name in custom perfumery by changing the way people connect with fragrance through creativity, affordability, and thoughtful craftsmanship." },
];

export default function AboutPage() {
  return (
    <div className="text-[#3b312e]">
      <Breadcrumb className="mx-auto mt-5 w-[90%] md:mt-8 lg:w-[80%]" items={[{ label: "Home", href: "/" }, { label: "About us" }]} />
      <section className="relative mx-auto mt-4 w-[90%] overflow-hidden rounded-2xl md:mt-10 lg:w-[80%]">
        <Image src={`${S}/aboutBannerDesk.webp`} alt="Ikonix about banner" width={1600} height={400} preload sizes="80vw" className="hidden w-full object-cover md:block" />
        <Image src={`${S}/BrandShowcaseBanner_mobile.webp`} alt="Ikonix about banner" width={800} height={800} preload sizes="90vw" className="block w-full object-cover md:hidden" />
        <h1 className="absolute z-10 hidden text-left font-heading leading-snug text-[#53443D] md:top-1/2 md:right-[18%] md:block md:-translate-y-1/2 md:text-3xl lg:text-4xl">About Us</h1>
      </section>
      <section className="mx-auto w-[90%] py-10 font-fancy md:py-16 lg:w-[80%]">
        <div className="flex flex-col items-center gap-8 md:flex-row-reverse md:items-center md:justify-center md:gap-10">
          <div className="order-1 space-y-4 md:order-none md:max-w-[560px]">
            <h2 className="mt-2 text-center font-heading text-2xl text-[#8C7367] md:text-left md:text-3xl">Who We Are</h2>
            <p className="mx-auto max-w-[340px] text-center text-[14px] leading-relaxed md:mx-0 md:max-w-none md:text-left">
              Ikonix is built around one simple idea - scent should be personal. We specialise in creating custom fragrances that capture who you are and what you love. Whether you’re after something entirely unique or a budget-friendly recreation of a popular favourite, every Ikonix perfume is thoughtfully made with care.
            </p>
            <p className="mx-auto max-w-[340px] text-center text-[14px] leading-relaxed md:mx-0 md:max-w-none md:text-left">
              Our team of experienced perfumers blends quality ingredients with attention to detail, ensuring each fragrance isn’t just wearable but also memorable. At Ikonix, we don’t believe in one-scent-fits-all. We’re here to help you find a fragrance that truly feels like you.
            </p>
          </div>
          <div className="order-2 flex justify-center md:order-none md:shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${S}/aboutmain.svg`} alt="Custom perfume illustration" className="w-full max-w-[320px] object-contain md:max-w-[520px]" />
          </div>
        </div>
      </section>
      <section className="bg-[#EDE2DD] py-10 md:py-14">
        <div className="mx-auto flex w-[90%] flex-col items-center gap-10 md:flex-row md:items-start md:justify-center md:gap-16 lg:w-[80%] lg:gap-24">
          {MISSION.map((m) => (
            <div key={m.title} className="flex flex-col items-center gap-4 text-center md:flex-row md:items-center md:gap-5 md:text-left">
              <div className="flex h-[70px] w-[70px] flex-shrink-0 items-center justify-center rounded-full bg-white shadow-sm md:h-16 md:w-16">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.icon} alt="" className="h-9 w-9 object-contain md:h-8 md:w-8" />
              </div>
              <div>
                <h3 className="mb-1 font-heading text-[22px] text-[#8C7367] md:text-xl">{m.title}</h3>
                <p className="mx-auto max-w-[300px] font-fancy text-[13px] leading-relaxed text-[#53443D] md:mx-0 md:max-w-[380px] md:text-[14px]">{m.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="mx-auto w-[90%] py-12 md:py-16 lg:w-[80%]">
        <h2 className="mb-10 text-center font-heading text-2xl text-[#B39384] md:text-3xl">Why Choose Us</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-6">
          {WHY_CHOOSE.map((w, i) => (
            <div key={w.title} className={`flex h-full flex-col items-center space-y-4 rounded-2xl bg-[#f5ece8] p-6 text-center md:p-8 ${i < 3 ? "lg:col-span-2" : i === 3 ? "lg:col-span-2 lg:col-start-2" : "lg:col-span-2 lg:col-start-4"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.icon} alt="" className="w-20 object-contain md:w-24" />
              <h3 className="font-fancy text-[18px] font-bold text-[#53443D] md:text-[21px]">{w.title}</h3>
              <p className="font-fancy text-[14px] font-normal text-[#53443D] md:text-[16px]">{w.text}</p>
            </div>
          ))}
        </div>
      </section>
      <SpecialDeals />
      <CustomFragrance />
    </div>
  );
}
