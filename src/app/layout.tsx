import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Lato, Poppins } from "next/font/google";
import "./globals.css";

// Typography of the legacy site: Poppins (body), Lato (.font-fancy), Luxia Display (headings).
const poppins = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-poppins", display: "swap" });
const lato = Lato({ subsets: ["latin"], weight: ["300", "400", "700"], variable: "--font-lato", display: "swap" });
const luxia = localFont({ src: "./fonts/LuxiaDisplay.otf", variable: "--font-luxia", display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Ikonix Perfumer | Custom & Long-Lasting Luxury Perfumes Online", template: "%s | Ikonix Perfumer" },
  description: "Ikonix Perfumer crafts personalised, long-lasting luxury fragrances and recreates popular scents with premium ingredients at affordable prices. Shop custom perfumes online in India.",
  openGraph: { siteName: "Ikonix Perfumer", type: "website", locale: "en_IN" },
  icons: { icon: { url: "/ikonix/site/logo.svg", type: "image/svg+xml" } }, // the legacy site's icon
};

export const viewport: Viewport = { themeColor: "#53443D" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${poppins.variable} ${lato.variable} ${luxia.variable}`}>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
