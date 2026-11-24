"use client";

import { capFirst } from "@/lib/format";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, EffectFade, Navigation, Pagination } from "swiper/modules";
import "swiper/css";
import "swiper/css/effect-fade";
import "swiper/css/navigation";
import "swiper/css/pagination";
import type { ProductCardDTO } from "@/lib/catalogue-types";
import { HomeProductCard } from "../product-cards";

const S = "/ikonix/site";
const R = `${S}/raster`; // see scripts/ikonix/rasterize-site-svgs.ts

// ── Desktop hero (legacy Gm): fading 4-slide slider with arrow images bottom-right ──
const HERO_DESKTOP = [
  { variant: "stock-up", title: "Stock up\non your\nfavourites!", image: `${S}/bannerDesk4.webp`, buttonText: "View Products", href: "/shop" },
  { title: "Define\n Your Signature", subtitle: "Discover timeless fragrances crafted to leave a lasting impression.", image: `${S}/bannerDesk1.webp`, buttonText: "View Products", href: "/shop" },
  { title: "Awaken \n Your Senses", subtitle: "Experience luxurious aromas designed to inspire every moment.", image: `${S}/bannerDesk2.webp`, buttonText: "View Products", href: "/shop" },
  { title: "Indulge in \n Signature Scents", subtitle: "Explore premium perfumes created to express your unique style.", image: `${S}/bannerDesk3.webp`, buttonText: "View Products", href: "/shop" },
];

export function HeroDesktop() {
  return (
    <div className="relative overflow-hidden rounded-[18px]">
      <Swiper modules={[Autoplay, EffectFade, Navigation]} effect="fade" fadeEffect={{ crossFade: true }} loop speed={500}
        autoplay={{ delay: 3000, disableOnInteraction: false }} navigation={{ prevEl: ".ikx-hero-prev", nextEl: ".ikx-hero-next" }} className="h-full w-full">
        {HERO_DESKTOP.map((s, i) => (
          <SwiperSlide key={s.image}>
            <div className={`relative aspect-[1128/520] overflow-hidden rounded-[18px] ${s.variant === "stock-up" ? "[container-type:inline-size]" : ""}`}>
              <Image src={s.image} alt={s.title.replace(/\s+/g, " ").trim()} fill fetchPriority={i === 0 ? "high" : undefined} sizes="(min-width:1024px) 80vw, 90vw" className="object-cover object-center" />
              {s.variant === "stock-up" ? (
                <div className="absolute top-[36.5%] left-[8.3%] flex flex-col items-start">
                  <h2 className="font-['Times_New_Roman',serif]">
                    {s.title.split("\n").map((line, j) => (
                      <span key={line} className={j === 0 ? "block text-[3.8cqw] leading-[0.95] font-normal text-white" : "block text-[5cqw] leading-[0.85] font-bold text-[#DDB849]"}>{line}</span>
                    ))}
                  </h2>
                  <Link href={s.href} className="mt-[1.1cqw] inline-flex h-[4cqw] w-[15cqw] items-center justify-center rounded-full bg-[#C5A28F] font-fancy text-[1.55cqw] font-normal text-[#111111] transition-colors duration-300 hover:bg-[#D1B09D]">{s.buttonText}</Link>
                </div>
              ) : (
                <div className="absolute inset-y-0 left-0 flex w-[48%] flex-col justify-center px-10 text-[#53443D] lg:ms-6 lg:px-16 2xl:ms-14">
                  <h2 className="font-heading text-[32px] leading-[0.95] font-medium whitespace-pre-line lg:text-[54px]">{s.title}</h2>
                  <p className="mt-3 max-w-[360px] font-fancy text-[10px] leading-relaxed whitespace-pre-line text-[#53443D] lg:text-[16px]">{s.subtitle}</p>
                  <Link href={s.href} className="mt-5 inline-flex w-fit items-center justify-center rounded-3xl bg-[#2d3545] px-5 py-2 text-[14px] font-medium text-white transition-colors duration-300 hover:bg-[#1f2633] lg:px-10 lg:py-4">{s.buttonText}</Link>
                </div>
              )}
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <button className="ikx-hero-prev absolute right-16 bottom-5 z-10" aria-label="Previous slide"><img src={`${S}/Arrow-left.svg`} alt="" /></button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <button className="ikx-hero-next absolute right-5 bottom-5 z-10" aria-label="Next slide"><img src={`${S}/Arrow-right.svg`} alt="" /></button>
    </div>
  );
}

// ── Mobile hero (legacy eh) ──
const HERO_MOBILE = [
  { title: "Stock Up on Your Favorites", subtitle: "Discover your signature scents and bring home the fragrances you love, every day.", image: `${S}/bannerMob4.webp`, buttonText: "Shop Now", href: "/shop", light: true },
  { title: "Define Your Signature", subtitle: "Discover timeless fragrances \n crafted to leave a lasting impression.", image: `${S}/bannerMob1.webp`, buttonText: "View Products", href: "/shop" },
  { title: "Awaken Your Senses", subtitle: "Experience luxurious aromas \n designed to inspire every moment.", image: `${S}/bannerMob2.webp`, buttonText: "View Products", href: "/shop" },
];

export function HeroMobile() {
  return (
    <div className="ikx-hero-mobile relative mx-auto w-[90%] overflow-hidden rounded-[6px] lg:w-[80%]">
      <Swiper modules={[Autoplay, EffectFade, Pagination]} effect="fade" fadeEffect={{ crossFade: true }} loop speed={400}
        autoplay={{ delay: 3000, disableOnInteraction: false }} pagination={{ clickable: true }}>
        {HERO_MOBILE.map((s, i) => (
          <SwiperSlide key={s.image}>
            <div className="relative h-[75svh] overflow-hidden rounded-[6px]">
              <Image src={s.image} alt={`Slide ${i + 1}`} fill fetchPriority={i === 0 ? "high" : undefined} sizes="90vw" className="rounded-[6px] object-cover" />
              <div className="absolute inset-0 flex flex-col items-center justify-between px-4 pt-10 pb-6 text-center sm:pt-12 sm:pb-10">
                <div className={s.light ? "invisible" : ""}>
                  <h2 className="mb-3 font-heading text-[22px] leading-tight font-semibold text-[#2F3A4A] sm:text-[28px]">{s.title}</h2>
                  <p className="font-fancy text-[13px] leading-relaxed whitespace-pre-line text-[#2F3A4A] sm:text-base">{s.subtitle}</p>
                </div>
                <Link href={s.href} className="inline-flex min-w-[150px] items-center justify-center rounded-xl bg-[#2F3A4A] px-6 py-2.5 text-[15px] leading-none font-medium whitespace-nowrap text-white transition-colors duration-300 active:bg-[#4A6FB5]">{s.buttonText}</Link>
              </div>
            </div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
}

// ── Best sellers with category tabs (legacy bh: first tab "Best Sellers", then categories; 8 per tab) ──
export function BestSellers({ tabs }: { tabs: { label: string; products: ProductCardDTO[] }[] }) {
  const [active, setActive] = useState(tabs[0]?.label);
  const current = tabs.find((t) => t.label === active) ?? tabs[0];
  return (
    <section className="mx-auto mt-2 w-[90%] py-2 md:mt-[4.5rem] md:py-6 lg:w-[80%]">
      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto md:mb-4 md:gap-4" role="tablist">
        {tabs.map((t) => (
          <button key={t.label} role="tab" aria-selected={active === t.label} onClick={() => setActive(t.label)}
            className={`flex-shrink-0 rounded-full px-4 py-1.5 font-fancy text-[13px] transition md:px-6 md:py-3 md:text-[16px] ${active === t.label ? "bg-[#b49d91] text-[#3f342c]" : "border border-[#c9b6a9] bg-transparent text-[#a08876]"}`}>
            {capFirst(t.label)}
          </button>
        ))}
      </div>
      <div className="no-scrollbar flex flex-row gap-6 overflow-x-auto sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-4">
        {current?.products.map((p) => <HomeProductCard key={p.id} p={p} />)}
      </div>
      <div className="mb-3 mt-4 flex justify-center md:mb-0 md:mt-8">
        <Link href="/shop" className="rounded-full bg-[#b49d91] px-7 py-2 font-fancy text-[14px] text-[#3f342c] transition hover:opacity-90 md:px-10 md:py-3 md:text-[17px]">View all Products</Link>
      </div>
    </section>
  );
}

// ── Special deals (legacy _m). Offer copy is the legacy banner text. ──
const DEALS = [
  { img: `${S}/ikonix_banner1.png`, title: "Buy 4 × 30ml, Get 1 FREE!", blurb: "Stock up on your favourites! Buy 4 bottles of 30ml and get 1 bottle absolutely FREE.", dark: true },
  { img: `${S}/ikonix_banner2.png`, title: "Buy 3 × 50ml, Get 1 FREE!", blurb: "More value, more savings! Buy 3 bottles of 50ml and get 1 bottle FREE.", dark: false },
  { img: `${S}/ikonix_banner3.png`, title: "Buy 2 × 100ml, Get 1 FREE!", blurb: "Go bigger and save more! Buy 2 bottles of 100ml and get 1 bottle FREE.", dark: true },
  { img: `${S}/ikonix_banner4.png`, title: "More Bottles, More Savings!", blurb: "Choose your favourite size, stock up and enjoy exclusive savings on your purchase.", dark: true },
];

function DealCard({ d }: { d: (typeof DEALS)[number] }) {
  return (
    <div className="relative overflow-hidden rounded-[24px]" style={{ containerType: "inline-size", aspectRatio: "1484 / 645" }}>
      <Image src={d.img} alt={d.title} fill sizes="(min-width:1024px) 40vw, 85vw" className="object-cover" />
      <div className="absolute inset-y-0 right-0 z-20 flex flex-col justify-center overflow-hidden text-left" style={{ width: "48%", paddingRight: "4cqw", color: d.dark ? "#2B1D17" : "#FFFFFF" }}>
        <span className="font-heading leading-tight" style={{ fontSize: "clamp(11px, 4.4cqw, 27px)" }}>{d.title}</span>
        <p className="hidden font-fancy leading-snug sm:block" style={{ fontSize: "clamp(11px, 2.6cqw, 13px)", marginTop: "1cqw" }}>{d.blurb}</p>
        <div className="flex flex-wrap items-center" style={{ gap: "2cqw", marginTop: "2cqw" }}>
          <Link href="/shop" className="rounded-[24px] bg-[#C5A291] font-fancy text-[#13181F]" style={{ fontSize: "clamp(10px, 2.8cqw, 14px)", padding: "1.2cqw 3.2cqw" }}>Add To Cart</Link>
        </div>
      </div>
    </div>
  );
}

export function SpecialDeals() {
  return (
    <section className="bg-[#e8d5cf] py-16">
      <div className="mx-auto w-[90%] px-0 lg:w-[80%] lg:px-4">
        <h2 className="text-center font-heading text-[27px] tracking-[0.5px] text-[#8C7367]">Special deals</h2>
        <p className="mx-auto w-full text-center font-fancy text-[16px] font-[400] text-[#53443D] md:w-[710px]">
          Our exclusive perfume creations blend rare ingredients and refined expertise. Discover captivating notes that tell your story with confidence and style.
        </p>
        <div className="no-scrollbar mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 lg:hidden">
          {DEALS.map((d) => <div key={d.img} className="w-[85%] flex-shrink-0 snap-start sm:w-[48%]"><DealCard d={d} /></div>)}
        </div>
        <div className="ikx-deals mt-12 hidden lg:block">
          <Swiper modules={[Navigation, Pagination]} slidesPerView={2} slidesPerGroup={2} spaceBetween={24} speed={500} navigation pagination={{ clickable: true }} className="!pb-10">
            {DEALS.map((d) => <SwiperSlide key={d.img}><DealCard d={d} /></SwiperSlide>)}
          </Swiper>
        </div>
      </div>
    </section>
  );
}

// ── Instagram (legacy uh) ──
const POSTS = [
  { img: `${S}/post1.jpeg`, title: "The Haze Of Desire" },
  { img: `${S}/post2.jpeg`, title: "Mystery In Every Mist" },
  { img: `${S}/post3.jpeg`, title: "A Fragrance Forged in Fire" },
  { img: `${S}/post4.jpeg`, title: "Smell expensive" },
];

export function InstagramStrip() {
  return (
    <section className="w-full bg-gradient-to-b from-[#c7a895] to-[#EDE2DD] pt-[20px] lg:bg-gradient-to-r lg:to-white">
      <div className="relative flex w-[90%] flex-col gap-1 max-md:mx-auto md:ml-auto md:flex-row md:items-end md:justify-between">
        <div className="relative mx-auto aspect-[365/372] w-full overflow-hidden md:mx-0 md:aspect-[365/352] md:w-[55%] lg:aspect-auto lg:w-[28%] lg:overflow-visible">
          <Image src={`${R}/instapage.webp`} alt="Instagram page preview" width={1080} height={1471} sizes="(min-width:1024px) 26vw, (min-width:768px) 50vw, 90vw" className="h-full w-full object-cover object-top lg:h-auto lg:object-contain" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/6 bg-gradient-to-t from-[#c7a895]/60 to-transparent lg:hidden" />
        </div>
        <div className="ikx-insta relative z-20 mt-[-1.5rem] ml-auto w-full overflow-hidden pb-[40px] md:flex-1 md:pl-4 lg:mt-0 lg:pb-0 max-md:pb-2">
          <Swiper modules={[Navigation]} rewind speed={600} navigation slidesPerView={1.5} centeredSlides spaceBetween={12}
            onInit={(s) => { if (window.innerWidth < 1024) s.slideTo(1, 0); }}
            breakpoints={{ 1024: { slidesPerView: 3, centeredSlides: false, spaceBetween: 16 } }}>
            {POSTS.map((p) => (
              <SwiperSlide key={p.img}>
                <Image src={p.img} alt={p.title} width={600} height={750} sizes="(min-width:1024px) 22vw, 80vw" className="w-full rounded-2xl object-cover shadow-lg" />
              </SwiperSlide>
            ))}
          </Swiper>
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-32 bg-gradient-to-l from-white via-white/80 to-transparent lg:flex" />
          <div className="mt-4 flex items-end gap-8 md:pb-12 2xl:mt-5">
            <div className="grid">
              <span className="text-left font-fancy text-[16px] leading-[150%] font-normal tracking-[0.5px] text-[#53443D]">Check us out on</span>
              <span className="text-left font-heading text-[36px] font-normal text-[#8C7367]">Instagram</span>
            </div>
            <a target="_blank" rel="noopener noreferrer" href="https://www.instagram.com/ikonix_perfumer/?hl=en" className="mb-3 rounded-[24px] bg-[#C5A291] px-[24px] py-[8px] font-fancy leading-none">Click here</a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Testimonials (legacy gh; copy and names are the legacy site's own content) ──
const TESTIMONIALS = [
  { img: `${R}/test1.webp`, name: "Arjun Menon", text: "I’ve tried many fragrances, but Ikonix perfumes truly stand out. The scent feels premium, lasts the entire day, and always gets compliments. It has now become my everyday signature fragrance." },
  { img: `${R}/test2.webp`, name: "Rahul Nair", text: "The quality of Ikonix perfumes is exceptional. The fragrance is rich, long-lasting, and perfectly balanced. I especially loved the custom perfume experience — it feels truly personal and unique." },
  { img: `${R}/test3.webp`, name: "Meera Thomas", text: "I absolutely love the elegance of Ikonix fragrances. The scent is sophisticated and stays for hours without fading. It’s now my go-to perfume for special occasions and daily wear." },
];

export function Testimonials() {
  return (
    <div className="w-full bg-white">
      <div className="ikx-testimonials mx-auto w-[90%] py-8 lg:w-[80%] lg:py-16">
        <div className="mx-auto w-[90%] lg:w-[700px]">
          <h2 className="text-center font-heading text-[27px] font-normal tracking-[0.5px] text-[#B39384]">User Testimonials</h2>
          <p className="text-center font-fancy text-[16px] font-normal tracking-[0.5px] text-[#53443D]">
            Hear what our customers say about their experience with Ikonix Perfumer. From signature scents to custom fragrances, our perfumes leave a lasting impression.
          </p>
        </div>
        <Swiper modules={[Navigation]} rewind speed={500} navigation slidesPerView={1} breakpoints={{ 1024: { slidesPerView: 2 }, 1536: { slidesPerView: 3 } }} className="mt-4">
          {TESTIMONIALS.map((t) => (
            <SwiperSlide key={t.name}>
              <div className="flex flex-col items-center p-4">
                <div className="rounded-[24px] bg-[#EDE2DD]">
                  <div className="mx-auto flex h-[250px] w-[300px] flex-col items-center justify-center gap-3">
                    <Image src={t.img} alt="" width={200} height={200} sizes="64px" className="h-16 w-16 rounded-full object-cover" />
                    <div className="grid p-2 text-center">
                      <span className="font-fancy text-[21px] font-bold text-[#C5A291]">{t.name}</span>
                      <span className="font-fancy text-[14px] text-gray-600">{t.text}</span>
                    </div>
                  </div>
                </div>
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </div>
  );
}
