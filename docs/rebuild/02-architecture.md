# Ikonix Rebuild: Phase 2 Architecture

Status: draft for review, updated 2026-11-23. Builds on [01-system-audit.md](01-system-audit.md).
Decisions already made: build in this repo; **MongoDB with Mongoose 9** (local `mongodb://127.0.0.1:27017/ikonix?replicaSet=rs0` for now; a hosted replica set such as Atlas for production); products-only migration; legacy source code to be supplied.
The PostgreSQL/Prisma design that preceded this was dropped at the user's request on 2026-11-23.

## 1. Shape of the system

A single Next.js 16 application, with no separate backend service. The Fysit physio code is removed as Ikonix screens replace it.

```
Browser ──► proxy.ts (Node runtime)
              │  session refresh/rotation, admin route gate, legacy URL redirects
              ▼
           App Router
              ├─ (store)/…           Server Components: home, shop, product, search, cart, checkout, account
              ├─ admin/…             Server Components + Client islands (tables, forms, uploads)
              ├─ Server Actions      all first-party mutations (cart, checkout, profile, admin CRUD)
              └─ api/… Route Handlers  only where an external party calls us or a non-HTML response is needed:
                                      Razorpay webhook, Google OAuth callback, SMS delivery-report webhook,
                                      search suggestions (GET JSON), CSV exports, invoice PDFs, cron endpoints
              ▼
           src/server/*  domain services (pure TS, no React); multi-document writes in MongoDB transactions
              ▼
           MongoDB replica set   object storage (R2 prod / public/ dev)   Razorpay   SMS   SMTP   Google
```

### Data layer (MongoDB)
- **Models:** `src/server/models/*` (Mongoose 9), 35 collections. Product variants and images are embedded in the product; cart and wishlist items are embedded; order lines, status history and shipments are embedded in the order. Inventory, payments, refunds, webhook events and redemptions are separate collections, because each needs its own atomic counter or unique key.
- **Replica set required.** Checkout writes the order, stock reservations and coupon usage in one multi-document transaction, and MongoDB only supports transactions on a replica set. Locally, the Homebrew `mongod` runs as single-node set `rs0` (config backup: `/usr/local/etc/mongod.conf.bak-before-replset`). Production must also be a replica set, which every Atlas tier is.
- **Schema ownership:** `scripts/ikonix/setup-db.ts` creates collections, server-side validators and indexes, and is idempotent. Apps and scripts connect with `autoCreate: false, autoIndex: false`, so nothing is created implicitly at runtime.
- **Type safety:** document types come from `InferSchemaType`. Models are registered with `defineModel(name, schema, collection)`, which also refuses to reuse a model name already owned by the old Fysit code (`User`, `AuditLog`, `Category`, `Redirect` clash until that code is removed). Don't pass explicit generic document types to `mongoose.model`: it makes `tsc` run out of memory.
- **Commands:** `npm run ikonix:setup-db`, `npm run ikonix:import`, `npm run ikonix:verify`.

Rules:
- Every read or write of protected data goes through `src/server/auth/dal.ts` (`requireCustomer()`, `requirePermission("orders.refund")`). Proxy checks are only optimistic. The DAL is the real gate, as the Next.js auth guide recommends.
- Client Components never import from `src/server`. `server-only` enforces this at build time.
- All input is parsed with Zod at the boundary: Server Action arguments, route handler bodies and webhook payloads.
- Money is integer paise everywhere, including in the browser. Values are formatted only for display.

### Target source layout

```
scripts/ikonix/         setup-db (collections, validators, indexes), import-catalogue, verify-db, extraction tools
src/app/(store)/        storefront routes
src/app/admin/          admin routes (layout requires a staff session with step-up)
src/app/api/            webhooks, oauth, exports, cron
src/server/             auth/, catalogue/, cart/, pricing/, checkout/, payments/, orders/, inventory/,
                        promotions/, notifications/, audit/, storage/, rate-limit/, db.ts
src/components/store/   storefront UI (legacy design language)
src/components/admin/   admin UI (reused Fysit kit, restyled)
src/lib/                framework-agnostic helpers (money, slugs, phone parsing)
```

## 2. Authentication and sessions

### 2.1 Customer sign-in methods
1. **Mobile + OTP.** The same flow signs in and registers. The first verification of a new number creates the user.
2. **Google.** OAuth 2.0 authorisation code flow with PKCE, `state` and `nonce`. The ID token is verified against Google's JWKS, and `email_verified` must be true.
3. **Existing session.** No OTP while a valid session exists, for up to 90 days.

**OTP flow** (`src/server/auth/otp.ts`):
- Generation: a 6-digit code from `crypto.randomInt`. The legacy site used 4 digits; 6 is the safer default and is configurable in `settings`.
- Storage: `HMAC-SHA256(code, OTP_PEPPER)` only. The code is never stored or logged.
- Lifetime: valid for 5 minutes. A partial unique index allows one live OTP per mobile and purpose; a resend replaces it.
- Resend: 30-second cooldown, at most 5 sends per mobile per hour and 10 per IP per hour. Limits live in `rate_limit_buckets`, so they hold across app instances.
- Verification: at most 5 attempts, then the OTP locks. Codes are compared in constant time.
- Abuse controls: the same wording comes back whether or not the number is registered, so accounts can't be enumerated. Only Indian mobiles (+91) are accepted at launch; this is configurable.
- Logging: each send, resend, delivery report, success, failure and lockout is written to `otp_events`.
- Delivery status: the SMS provider's delivery-report webhook updates `otp_verifications.deliveryStatus`.

**Account linking:** a Google sign-in whose verified email matches an existing account is *not* merged automatically. The server creates an `account_link_requests` row and sends an OTP to that account's mobile. Only a verified OTP attaches the Google identity. An email that matches nothing creates a new user. A mobile number is collected later, at checkout or in the profile, and verified by OTP.

### 2.2 Session model (90-day persistent login)
| Item | Value |
|---|---|
| `sessions` document | One per device. `expiresAt` = sign-in + **90 days (absolute, never extended)**. `idleExpiresAt` = 30 days sliding. The model's validation rejects anything longer than 90 days; a TTL index purges sessions a week after they expire. |
| Access cookie `__Host-ikx_at` | JWT (HS256, `jose`), **10 minutes**, containing `sid`, `uid` and `kind`. HttpOnly, Secure, SameSite=Lax, Path=/. |
| Refresh cookie `__Host-ikx_rt` | 256-bit random opaque token; only its SHA-256 is stored in `refresh_tokens`. HttpOnly, Secure, SameSite=Lax, Path=/. The cookie's Max-Age matches the session's remaining lifetime. |
| Rotation | `proxy.ts` handles requests whose access token has expired but whose refresh cookie is present. In one transaction it marks the old token `usedAt`, issues a new one and bumps `idleExpiresAt`. It then sets both cookies on the response, and on the forwarded request so Server Components see them immediately. |
| Reuse detection | A refresh token that is already `usedAt` gets the **whole session revoked** (`TOKEN_REUSE`) and both cookies cleared. A 30-second grace window lets parallel tabs share one rotation without false positives. |
| Revocation | `revokedAt` takes effect at the next DAL call, because the DAL checks the session document on every protected read (deduplicated per request with React `cache`). The proxy's JWT check is only for routing. |
| Revoke triggers | Logout; "sign out other devices"; admin revoke; suspension (all sessions); security changes such as a mobile number change or a Google link or unlink (all other sessions). |
| Device list | Customers see their active sessions (device label from the user agent, IP city if available, last seen) and can end any of them. |
| Tokens in JS | None. Nothing auth-related goes in localStorage. |

Admins use the same collections with `kind = ADMIN`: 12-hour absolute lifetime and 30-minute idle timeout.

### 2.3 Admin access
- Signing in to `/admin` needs **Google sign-in followed by OTP step-up** to the staff member's verified mobile (`stepUpVerifiedAt`).
- Having a Google account grants nothing. Access requires at least one row in `user_roles`, created by a Super Admin and recorded in the audit log.
- Permissions are checked server-side with `requirePermission(key)` in every admin Server Action and route handler. The UI hides what a role can't do, but hiding is cosmetic.

| Permission group | Super Admin | Product Mgr | Order Mgr | Marketing Mgr | Support |
|---|:-:|:-:|:-:|:-:|:-:|
| products, brands, categories, inventory | ✓ | ✓ | read | read | read |
| orders, shipping, returns | ✓ | read | ✓ | read | read |
| refunds | ✓ | | ✓ | | |
| promotions, banners, homepage | ✓ | | | ✓ | |
| customers (view, notes) | ✓ | | ✓ | | ✓ |
| customers (suspend, revoke sessions) | ✓ | | | | |
| reports: sales and finance | ✓ | | | | |
| staff, roles, settings | ✓ | | | | |

## 3. Catalogue
- **Import (done and verified, 2026-11-23):** `scripts/ikonix/import-catalogue.ts` reads `public/ikonix/export/all-products.json` and is safe to re-run: IDs stay stable and stock entered later is never overwritten. Result: 413 products (395 ACTIVE, 18 DRAFT with listed `reviewIssues`), 1,239 variants (3 inactive with invalid legacy prices), 2,845 images, 1,239 inventory records, 3 categories, the best-sellers collection (48), and 102 inspiration brands plus the house brand. Mapping:
  - categories mens, women's and unisex become categories;
  - "best sellers" becomes a **collection**, and each of its products gets a gender category from its description where one exists;
  - inspiration brands (102) become `Brand` rows of kind `INSPIRATION`, and Ikonix becomes the `HOUSE` brand;
  - sizes become variants with `sizeUnit = "ml"` (the legacy UI shows "ml");
  - images become `product_images`, with variant images linked to their variant.
  - Products import as `ACTIVE`, apart from the 2 with no description, which import as `DRAFT` for review.
  - Stock: the legacy API exposes only in-stock or out-of-stock, so **inventory starts at 0 and must be entered before launch**. A clearly labelled admin bulk action can set an opening quantity.
- **SKUs:** the legacy site has none. Proposed pattern `IKX-{legacyId}-{size}`, e.g. `IKX-86-30`. It's unique, readable and editable later. Needs your approval.
- **URLs:** `/products/{slug}`. Legacy `/product-details/{id}` and `/product-details/{id}?vid=` get 301 redirects to the slug (variant preserved), done in `proxy.ts` from `products.legacyId`.
- **Search:** a weighted MongoDB text index (`product_search`: name, inspiration name, subtitle, SKU) handles full-word search. Prefix suggestions ("dio" → Dior) use anchored case-insensitive regex on indexed fields, which is fine at 400 products. If typo tolerance is needed later, Atlas Search (Lucene) can replace both without a schema change. Suggestions come from a cached `GET /api/search/suggest?q=`. Recent searches stay in the browser only.
- **Listing:** server-side filter, sort and paginate on `products`, using the denormalised `minSalePrice`, `maxDiscountBps`, `soldCount` and `ratingAverage`. Filters and sort are in the URL, so pages are shareable and crawlable. Page size is 24 for the store and 20/50/100 for admin.

## 4. Cart, pricing, checkout and inventory

### 4.1 One pricing engine
`src/server/pricing/price-cart.ts` is a **pure, deterministic function**:
`priceCart({ lines, customer, couponCode, shippingMethod, country, now }, rules) → Quote`.
- Cart display, checkout, order creation and Razorpay amount calculation all call it with data re-read from the DB. The client never sends prices.
- Order of application: line prices (variant `salePrice`) → automatic promotions → coupon → stacking resolution (non-stackable promotions compete, the highest customer benefit wins, priority breaks ties; stackable ones may combine) → per-promotion `maxDiscount` and line-level allocation → shipping (method charge, free above threshold, FREE_SHIPPING promotions) → packing → tax.
- BUY_X_GET_Y gives the cheapest qualifying units free or discounted (configurable). The legacy free-bottle offer becomes such a promotion once its rule is known.
- The engine's output is stored in `orders.pricingSnapshot`, and the `orders` collection validator enforces `grandTotal = subtotal − discount + shipping + packing + tax`.
- **Pending legacy source:** tax treatment (GST inclusive or exclusive, rate), packing charge, delivery method table and the free-bottle rule. Until then these stay as `settings` and `shipping_methods` data with no defaults, and checkout refuses to price if they are missing.

### 4.2 Checkout transaction
1. The client sends `idempotencyKey`, address, shipping method and coupon. Server: re-price; then in **one MongoDB transaction** (`session.withTransaction`, which retries transient errors):
   - insert the order (unique `idempotencyKey`, so a retry returns the same order);
   - reserve stock per line with `inventory.updateOne({ variantId, $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, q] } }, { $inc: { reserved: q } })`; `matchedCount === 0` means out of stock, so the whole transaction aborts (verified: no oversell);
   - write `RESERVE` inventory movements;
   - record coupon usage with a conditional `$inc` that respects `usageLimitTotal`, also enforced by the collection validator.
2. Create the Razorpay order for `grandTotal`. Then `payments(CREATED)`, `reservationExpiresAt` = now + 30 minutes.
3. Razorpay Checkout opens in the browser. On its handler, the client posts `razorpay_order_id`, `payment_id` and `signature`. The server verifies the HMAC, fetches the payment from the Razorpay API to confirm status and amount, then marks `CAPTURED`, sets the order to `CONFIRMED` and converts the reservation into a `SALE` (onHand −q, reserved −q).
4. **The webhook is the source of truth**: `payment.captured`, `payment.failed`, `order.paid` and `refund.*`. It handles cases where the browser closed. It is processed idempotently: the `webhook_events` unique `eventId` blocks repeats, and status transitions are guarded by the current status.
5. A cron sweep cancels unpaid orders past `reservationExpiresAt` and releases their stock (`RELEASE` movements).
6. Guest checkout is kept (it exists on the legacy site): `orders.userId` is null and contact details are snapshotted. Guest order lookup uses order number + OTP to the order's mobile.

### 4.3 Integrity enforced by MongoDB itself (`setup-db.ts` validators)
These validators apply to every write, including raw `updateOne`/`$inc` that skip Mongoose validation. `verify-db.ts` proves each one by attempting the bad write:
- `inventory`: `onHand ≥ 0`, `reserved ≥ 0`, `reserved ≤ onHand`.
- `products`: every **active** variant has `salePrice ≤ regularPrice`, and prices are non-negative.
- `orders`: grand total equals its components.
- `product_reviews`: rating 1–5. `promotions`: `usageCount ≤ usageLimitTotal`. `payments`: amount ≥ 1.
- Unique and partial indexes: one live OTP per mobile and purpose; unique SKU across all products; unique slug, legacy ID, order number, idempotency key, Razorpay order/payment ID, webhook event ID and notification dedupe key.
- Mongoose-level validation (app writes): session ≤ 90 days, coupon code required, Buy X Get Y quantities, a cart variant appears once, and order line totals add up.

## 5. Payments (Razorpay)
- Keep Razorpay (the legacy provider). Methods: UPI (collect and intent), cards, net banking, wallets (Paytm etc.), and whatever else the account has enabled.
- **UPI app handoff:** no hand-built `upi://` links. Razorpay Checkout's own intent flow lists the installed UPI apps (Google Pay, PhonePe, Paytm…) on Android mobile web. iOS support varies by app, so Checkout falls back to UPI collect or QR. This must be tested on a real Android phone and a real iPhone before launch; emulators don't reproduce app handoff.
- Webhook: `POST /api/webhooks/razorpay`, which reads the raw body, verifies `X-Razorpay-Signature` with `RAZORPAY_WEBHOOK_SECRET` in constant time, stores the event, then processes it. The secret is currently **empty** in `.env`.
- Refunds go through the admin (permission `orders.refund`) and the Razorpay Refunds API; status comes back via `refund.processed` and `refund.failed` webhooks.

## 6. Orders, notifications, jobs
- Status transitions are defined once in an allowed-transitions table. Each change appends to the order's embedded `statusHistory` (who, when, why) and queues notifications.
- Notifications are rows in `notifications`, sent by a dispatcher. The `dedupeKey` (unique) blocks duplicates. Channels: SMS (OTP and order updates), email (SMTP), WhatsApp (only if a provider is configured), and in-app.
- Scheduled jobs:
  - every 5 minutes: release expired reservations;
  - every minute: dispatch notifications;
  - hourly: purge expired OTPs, rate-limit buckets and sessions;
  - daily: low-stock digest.

  These run through cron endpoints protected by `CRON_SECRET`. The trigger depends on hosting: Vercel Cron, or a system cron calling the URL on a VPS.

## 7. Images and storage
- Production: Cloudflare R2 (S3 API) behind a custom domain such as `images.ikonixperfumer.com`. `next/image` uses a custom loader or `remotePatterns`. Admin uploads are validated by magic bytes (`file-type`, already a dependency), limited to 10 MB, re-encoded to WebP with `sharp` and stored with SHA-256 keys.
- Development: the extracted files in `public/ikonix/products/`. The import records `storageKey` so a one-off sync can push the same keys to R2.

## 8. SEO and performance
- Product, category and brand pages are server-rendered with `generateMetadata`: a unique title and description (generated from name, inspiration and notes when the SEO fields are empty), a canonical URL, Open Graph, and JSON-LD `Product`, `Offer` and `BreadcrumbList`.
- `sitemap.ts` and `robots.ts` already exist in the repo pattern and will be rewritten for products and categories. Legacy URLs get 301s (§3).
- Catalogue reads are cached and revalidated by tag (`product:{id}`, `catalogue`) when the admin saves. Images go through `next/image` with explicit dimensions (no layout shift) and responsive `sizes`. Client JS is limited to the gallery, variant picker, cart drawer, filters drawer and checkout.

## 9. Environment variables
| Variable | Status |
|---|---|
| `MONGODB_URI` | set to local `mongodb://127.0.0.1:27017/ikonix?replicaSet=rs0`; production needs a hosted replica set |
| `SESSION_SECRET` (rotate), `OTP_PEPPER` | `SESSION_SECRET` exists but belongs to the Fysit project, so generate new ones |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **needed** |
| `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_SENDER_ID`, `SMS_OTP_TEMPLATE_ID` (DLT-registered in India) | **needed** |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | test keys present |
| `RAZORPAY_WEBHOOK_SECRET` | **needed** |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | needed before production |
| `SMTP_*`, `EMAIL_*` | present, but must be an Ikonix sender |
| `CRON_SECRET` | generated at deploy |
| `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GTM_ID`, `NEXT_PUBLIC_META_PIXEL_ID` | take from the legacy site |

## 10. API surface (first-party contracts)
Server Actions (typed inputs via Zod; each returns `{ ok: true, data } | { ok: false, error: { code, message, fields? } }`):
- `auth.requestOtp({ mobile, purpose })`, `auth.verifyOtp({ mobile, code })`, `auth.logout()`, `auth.revokeSession({ sessionId })`, `auth.revokeOtherSessions()`
- `cart.add({ variantId, quantity })`, `cart.update`, `cart.remove`, `cart.applyCoupon({ code })`, `cart.mergeGuestCart({ lines })`, `cart.quote({ shippingMethodId?, country? })`
- `checkout.placeOrder({ idempotencyKey, addressId | address, billing?, shippingMethodId, couponCode?, note? })` → `{ orderId, razorpay: { keyId, orderId, amount, currency } }`
- `checkout.confirmPayment({ orderId, razorpayOrderId, razorpayPaymentId, signature })`
- `account.*` (profile, addresses, wishlist, reviews), `orders.requestCancellation`, `orders.requestReturn`
- `admin.products.*`, `admin.orders.*`, `admin.customers.*`, `admin.promotions.*`, `admin.content.*`: each starts with `requirePermission`

Route Handlers:
- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `POST /api/webhooks/razorpay`
- `POST /api/webhooks/sms`
- `GET /api/search/suggest`
- `GET /api/admin/exports/{products|orders|customers|reports}.csv`
- `GET /api/orders/{id}/invoice.pdf`
- `POST /api/cron/{release-reservations|dispatch-notifications|cleanup}`

## 11. Open items that block later phases
| Item | Blocks |
|---|---|
| Legacy source code (rules, CSS, fonts, 48 design assets) | Phase 3 visual fidelity; Phase 5 pricing |
| Production MongoDB (replica set, e.g. Atlas) | Phase 8 only; local development is unblocked |
| Corrected prices and sizes for 6 DRAFT products, and categories for 10 | Publishing those 18 products |
| SMS provider + DLT template | Phase 4 OTP |
| Google OAuth client | Phase 4 Google login, admin login |
| Razorpay webhook secret (test) | Phase 5 |
| SKU pattern approval; opening stock quantities | Import / launch |
| Hosting target (Vercel or VPS) | Cron, R2 wiring, Phase 8 |
