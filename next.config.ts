import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// CSP without per-request nonces keeps the public pages statically cacheable. Scripts are limited to this
// origin plus Razorpay Checkout; Next.js needs 'unsafe-inline' for its bootstrap scripts without nonces.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com https://*.googleusercontent.com https://*.razorpay.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://checkout.razorpay.com" + (isDev ? " ws: wss:" : ""),
  "frame-src https://api.razorpay.com https://checkout.razorpay.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Product photos come from Cloudinary and are resized there by src/lib/cloudinary-loader.ts.
    // The allow-list still pins this account's path in case the default loader is ever used.
    remotePatterns: [new URL(`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME ?? "unset"}/image/upload/**`), { protocol: "https", hostname: "*.googleusercontent.com", pathname: "/**" }],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
          ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Legacy account routes → the new account section.
      { source: "/:path(profile|user-profile)", destination: "/account/profile", permanent: false },
      { source: "/orders", destination: "/account/orders", permanent: false },
      { source: "/addresses", destination: "/account/addresses", permanent: false },
      // Legacy search submit went to /search?q=…; results now live on the shop page.
      { source: "/search", destination: "/shop", permanent: true },
    ];
  },
};

export default nextConfig;
