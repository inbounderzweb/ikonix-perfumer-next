# Ikonix Rebuild: Phase 1 System Audit

Date: 2026-11-20. Sources: this repository, the product extraction in `public/ikonix/`, and the legacy site's production JS bundle (`/static/js/main.8f86bfeb.js`) plus homepage HTML, fetched with the owner's authorised session. Legacy backend source code has **not** been seen. Statements about server-side behaviour are inferred from what the frontend sends and receives, and are marked that way.

## 1. This repository

The repo is **not an Ikonix codebase**. `package.json` is named `fysit`, and `src/` is a physiotherapy-clinic CMS ("The Fysit", Bangalore): doctors, services, locations, appointments, blog and testimonials.

| Area | What exists | Verdict for Ikonix |
|---|---|---|
| Framework | Next.js 16.3.5, React 19.2.8, Tailwind 4, TS, Zod 4 | Keep. Matches the target stack. Next 16 uses `src/proxy.ts`, not `middleware.ts`. |
| Database | Mongoose 9 models; `MONGODB_URI` was **empty** | Keep MongoDB + Mongoose (decided 2026-11-23); new Ikonix models in `src/server/models`. Local replica set `rs0` now holds the imported catalogue. |
| Auth | Stateless 7-day HS256 JWT cookie (`src/lib/session.ts`), bcrypt admin passwords | Replace. No server-side sessions, rotation, reuse detection or revocation. |
| Rate limiting | In-memory `Map` (`src/lib/rate-limit.ts`) | Replace with a DB- or Redis-backed limiter. In-memory limits reset on deploy and don't work across instances. |
| RBAC / audit | `src/lib/permissions.ts`, `AuditLog` model, `audit.service.ts` | Pattern reusable; re-implemented as Ikonix `roles` and `audit_logs` collections with the five roles from the spec. |
| Admin UI kit | `components/admin/ui/*` (table, modal, form, badge, list controls), admin shell, charts, media library | Reusable after restyling. Saves real time on Phase 6. |
| Media | Cloudinary SDK, credentials **empty** | Replace with R2 (S3 API) for production and local `public/` for development, as specified. |
| Public site | Physio pages and sections | Not reusable. Remove once Ikonix pages replace them. |

## 2. Legacy site: business functionality found in the bundle

The legacy frontend is a React SPA (Create React App, Tailwind, axios, react-slick). The backend is PHP 8.3 under `/beta/api`; the `ci_session` cookie suggests CodeIgniter. Imunify360 bot protection sits in front of it.

**Routes:** `/`, `/shop`, `/product-details/:pid` (with `?vid=` variant), `/about`, `/contact`, `/checkout`, `/payment-landing`, `/order-confirmation`, `/orders`, `/addresses`, `/profile`, `/user-profile`.

**API endpoints the frontend calls:** `validate` (guest token), `products`, `products/{id}`, `login`, `register`, `forgot-password`, `cart` (read/add; also returns delivery, tax, packing and total for a chosen delivery method and country), `delete-cart`, `delivery-methods`, `address`, `address/add|edit|delete`, `checkout`, `guest-checkout`, `payment/create-order`, `payment/callback`, `guest-payment/create-order`, `guest-payment/callback`.

| Function | Legacy behaviour | Notes for the rebuild |
|---|---|---|
| Login / register | Name + 10-digit mobile + **password**, then a **4-digit SMS OTP** (`otp_login: 1`). Also forgot-password by OTP. | Spec replaces this with OTP-only plus Google. Existing customer passwords can't be carried over in any case. |
| Guest checkout | "Login / Signup" or "Checkout as Guest", with separate guest payment endpoints | Keep guest checkout. |
| Shop | Tabs: All, Featured, then per category; **10 products per page** via `?page=` | Spec adds filters and sorting on top. |
| Search | Header overlay, "Search products, collections…", keyboard navigation over suggestions | Keep the interaction. |
| PDP | Variant chips (30/50/100 ml), "About This Product", "Specifications", stock state, special-offer box | Sizes are shown as `"<value> ml"`, so `ml` is the unit. |
| Cart | Server cart per user, local cart for guests | Matches the spec (merge on login). |
| Free-bottle offer | Cart API returns `free_items` (`free_qty`, `final_price: 0`); UI shows "Free bottle … × N free" with a celebration toast | **The rule lives in the legacy backend and is unknown** (e.g. buy 2 get 1). Needed before Phase 5. |
| Delivery | Delivery methods from the API; charge per method and country; "Enjoy Free Delivery on Orders Over ₹1,099/-" | Method list and charge table are server-side and unknown. The ₹1,099 threshold is visible in the UI. |
| Tax and packing | Separate `tax` and `packing` lines in the cart total | Rates are unknown (server-side). |
| Addresses | Saved addresses with type, shipping vs billing, optional **company + GST number**; geolocation autofill via OpenStreetMap Nominatim | Keep GST and company fields for B2B invoices. |
| Payment | Razorpay Checkout: create-order on the server, callback with `razorpay_payment_id` + `signature` verified on the server | Same provider. `.env` has **test** keys; the webhook secret is empty. |
| Orders | Order list, address, "Track Package", status text mapped to a 3-step tracker; cancel/refund/return shown as a terminal state | Spec expands to 11 statuses. |
| Analytics | GA4 / GTM ecommerce events, Meta Pixel (`fbevents.js`) | IDs are not in `.env`; take them from the legacy site. |
| Other content | "Start Your Custom Fragrance", "Why Choose Us", "Special deals", user testimonials, Instagram strip, WhatsApp button (`wa.me/919019951335`), contact `ikonixperfumer@gmail.com`, stores: Kammanahalli, Electronic City, Commercial Street | Custom-fragrance flow: form only, or an order type? Unknown. |

Not present in the legacy frontend: wishlist, reviews, coupons entered by the customer (the only coupon reference is an analytics field), invoices, Google login and brand pages. These are **new features** from the spec, not reproductions.

## 3. Legacy design language (from bundle classes)

- **Palette:** taupe and brown `#53443D` (theme colour), `#6D5A52`, `#6C5950`, `#8C7367`, `#B39384`, `#B49D91`, `#D2BFB7`; blush backgrounds `#EADCD5`, `#EDE2DD`, `#F6EBE6`, `#FDF8F5`; navy `#2A3443`, `#2D3545`, `#1E2633`; ink `#3D3934`.
- **Type:** Lato for body text; a custom display face named `luxia`; a `font-fancy` utility whose font is unknown (defined in CSS I have not retrieved).
- **Shapes:** pill badges (`rounded-[24px]`), thin taupe borders, slick carousel dots in `#8C7367`.
- **SEO:** title "Ikonix Perfumer | Custom & Long-Lasting Luxury Perfumes Online".

**Not yet retrieved:** the site CSS (`main.4958c3e7.css`, which holds the font files) and the 48 assets in `/static/media/`. Those include the logo, footer logo, 4 desktop and 3 mobile hero banners, 4 `ikonix_banner` images, the brand showcase banner, USP and info icons, testimonial and Instagram images, and the WhatsApp icon. No page screenshots exist yet. **Visual fidelity can't be confirmed until these are available.**

## 4. Product data (extraction, validated)

413 products and 1,239 variants (30/50/100 ml), 2,849 images, 4 categories (mens, women's, unisex, best sellers). Validator passed. See `public/ikonix/export/extraction-report.json`.

Gaps the import must handle:
- No SKU, brand, stock quantity, SEO fields or dates in the source. SKUs will need generating (pattern to be approved).
- "best sellers" is stored as the product's only category, so 48 products have no gender category. This should become a merchandising flag, not a category.
- 14 duplicate product names.
- Many products share the same generic bottle photos (about 458 distinct images).

## 5. Integrations status

| Need | Status |
|---|---|
| MongoDB | Local Homebrew `mongod` 7.0.31, now a single-node replica set `rs0` at `127.0.0.1:27017` (database `ikonix`). It had crashed twice when the disk filled up. Production: hosted replica set still needed. |
| Razorpay | Test key ID and secret set; webhook secret empty; live keys needed later. |
| SMS OTP provider | **None.** Legacy provider unknown (server-side). |
| Google OAuth client | **None.** |
| Object storage (R2) | **None.** |
| Email (SMTP) | Set, but the account belongs to another project. Ikonix needs its own sender. |
| WhatsApp | Click-to-chat link only; no API provider. |
| Shipping / tracking | Unknown. Legacy shows "Track Package"; no carrier integration is visible. |

## 6. Information needed from the business

1. Legacy backend source or a DB dump: offer rules, delivery methods and charges, tax and packing rules, order statuses, and customers and orders if they will be migrated.
2. The 48 static assets, CSS and fonts (or a fresh authorised session so they can be downloaded), plus desktop and mobile screenshots of every page.
3. The free-bottle offer rule, the delivery charge table, and tax and packing rates, if no source is available.
4. Credentials: SMS provider, Google OAuth client, R2 bucket, production MongoDB (replica set), Razorpay live keys and webhook secret.
5. SKU pattern, and whether existing product URLs (`/product-details/{id}`) need 301 redirects to the new slugs (recommended for SEO).
