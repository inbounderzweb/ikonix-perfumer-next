import Link from "next/link";

// Store locations and links exactly as on the legacy footer (map links shortened to their destination address).
const STORES = [
  { name: "Kammanahalli", q: "IKONIX PERFUMER-Kammanahalli, MARIYAPPA CIRCLE, CMR Main Rd, HRBR Layout 3rd Block, HRBR Layout, Kalyan Nagar, Bengaluru, Karnataka 560043" },
  { name: "Electronic City", q: "circle, opposite to Max, neeladri Nagar, electronic city, Karuna Nagar, Electronic City Phase I, Doddathoguru, Bengaluru, Karnataka 560100" },
  { name: "Indiranagar", q: "198, Manjunatha Complex, Chinmaya Mission Hospital Rd, Indira Nagar II Stage, Hoysala Nagar, Indiranagar, Bengaluru, Karnataka 560038" },
  { name: "Commercial Street", q: "74, Kamaraj Rd, Tasker Town, Sampangi Rama Nagar, Bengaluru, Karnataka 560042" },
];
const mapUrl = (q: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;

const Facebook = () => (<svg viewBox="0 0 512 512" className="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M512 256C512 114.6 397.4 0 256 0S0 114.6 0 256C0 376 82.7 476.8 194.2 504.5V334.2H141.4V256h52.8V222.3c0-87.1 39.4-127.5 125-127.5c16.2 0 44.2 3.2 55.7 6.4V172c-6-.6-16.5-1-29.6-1c-42 0-58.2 15.9-58.2 57.2V256h83.6l-14.4 78.2H287V510.1C413.8 494.8 512 386.9 512 256h0z" /></svg>);
const Instagram = () => (<svg viewBox="0 0 448 512" className="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z" /></svg>);

export function Footer() {
  return (
    <footer className="bg-[#EDE2DD] py-10 pb-28 text-[#7E675F] md:py-12">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-12 px-7 md:grid-cols-4 md:gap-8 md:px-4">
        <div className="col-span-2 mb-2 flex justify-center md:col-span-1 md:mb-0 md:justify-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ikonix/site/footerlogo.svg" alt="Ikonix Logo" className="h-12 md:mb-4 md:h-8" />
        </div>
        <div>
          <h4 className="mb-6 text-base font-medium text-[#BFA290] md:mb-4">Contact Info</h4>
          <ul className="space-y-5 text-base text-[#3D3934] md:space-y-2">
            {STORES.map((s) => (
              <li key={s.name}><a href={mapUrl(s.q)} target="_blank" rel="noopener noreferrer" className="block">{s.name}</a></li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="mb-6 text-base font-medium text-[#BFA290] md:mb-4">Links</h4>
          <ul className="space-y-7 text-base text-[#3D3934] md:space-y-2">
            <li><Link href="/about">About Us</Link></li>
            <li><Link href="/shop">Products</Link></li>
            <li><Link href="/contact">Contact Us</Link></li>
          </ul>
        </div>
        <div className="col-span-2 md:col-span-1">
          <div className="mb-6 flex items-center gap-4 md:hidden">
            <span className="h-px flex-1 bg-[#D9C7BE]" />
            <h4 className="text-sm font-medium whitespace-nowrap text-[#BFA290]">Follow us</h4>
            <span className="h-px flex-1 bg-[#D9C7BE]" />
          </div>
          <h4 className="mb-4 hidden font-medium text-[#BFA290] md:block">Follow us</h4>
          <ul className="flex items-center justify-center gap-3 text-[#3D3934] md:flex-col md:items-start md:justify-start">
            <li><a href="https://www.facebook.com/p/Ikonix-Perfumer-100091090007818/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 md:gap-3"><Facebook /><span className="text-sm md:text-base">Facebook</span></a></li>
            <li><a href="https://www.instagram.com/ikonix_perfumer/?hl=en" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 md:gap-3"><Instagram /><span className="text-sm md:text-base">Instagram</span></a></li>
            {/* The legacy footer lists X.com with no profile link (href="#"); omitted until a real URL is provided. */}
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-8 flex w-[90%] flex-col items-center justify-between gap-2 border-t border-[#E0D6CF] pt-4 text-center text-xs md:flex-row md:gap-0 md:text-sm lg:w-[80%]">
        <p>Copyright © {new Date().getFullYear()} &nbsp;|&nbsp; Ikonix Perfumer &nbsp;|&nbsp; All Rights Reserved</p>
        {/* Legacy shows these as plain text with no pages behind them; kept as text until the policy content is supplied. */}
        <div className="mt-2 flex gap-4 md:mt-0"><p>Terms &amp; Conditions</p><p>Privacy Policy</p></div>
      </div>
    </footer>
  );
}
