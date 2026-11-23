# Prioritised remediation plan (awaiting approval)

Principles: separate branch, small commits, `tsc`+`eslint`+`build`+both test suites after each step, measure Lighthouse before/after, nothing deployed.

## Wave 1: blockers (about 1 to 2 days)
1. **P-01/P-02 Assets**: convert the four big SVGs to WebP/AVIF (keep originals out of git), serve via `next/image` with dimensions, add `prefetch={false}` on footer/header links where it triggers heavy preloads, immutable caching for `/ikonix/*`. Re-measure.
2. **F-01** fix wishlist links.
3. **S-04/S-06/SEO-01/SEO-02**: rate-limit search and cart view, anchored/indexed search, robots rules, home h1 + canonical.
4. **S-01/S-02/S-03/S-11**: remove legacy creds from `.env`, hash the admin password, create the Razorpay webhook (needs you), untrack build artefacts.

## Wave 2: marketing infrastructure (about 2 to 3 days, needs your IDs)
5. Consent banner + Consent Mode v2, single GTM loader, CSP update for tag domains, typed dataLayer module, all listed events, server-verified one-time `purchase`, UTM capture.
6. GA4 / Ads / Meta configured in GTM; validate with Tag Assistant, DebugView, Events Manager on a Razorpay **test** order.

## Wave 3: product hardening (about 1 week)
7. P-03 make product/shop pages statically revalidated; P-04/P-05 LCP and JS reductions; accessibility fixes.
8. Admin MFA (S-07), Sentry + structured redacted logging + payment/webhook alerts (S-08), SEO structured data (SEO-04), image-account decision (SEO-03).
9. Missing features by business priority: customer cancel/return, coupons, banners, reports/exports, notifications (F-02 to F-04).

## Production prerequisites (not code)
Production MongoDB with auth/TLS/backups and restore test; real SMS provider; Google OAuth credentials; HTTPS domain and `NEXT_PUBLIC_SITE_URL`; Razorpay live keys; retention policy (S-10).

## Decisions I need from you
1. Approve Wave 1 as-is?
2. Which Cloudinary account is canonical (`iombhcei` has the images; `.env` points to a different one)?
3. GTM/GA4/Ads/Meta IDs and whether to serve customers outside India (consent defaults).
4. Is the legacy API credential in `.env` still live (rotate it)?
