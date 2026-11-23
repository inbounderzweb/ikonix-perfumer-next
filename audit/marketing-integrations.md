# Marketing and analytics: current state and proposed design

## Current state (verified by code search)
- **Nothing is implemented**: no GTM, GA4, Google Ads, Meta Pixel, consent banner, dataLayer or UTM capture. `NEXT_PUBLIC_GTM_ID` and `NEXT_PUBLIC_GA_ID` exist in `.env` but are read nowhere.
- CSP currently blocks any tag script except Razorpay; GTM, GA4 and Meta domains must be added deliberately (S-05).
- Do not run GA4 both inside GTM **and** as a separate `NEXT_PUBLIC_GA_ID` gtag; that double-counts. Plan: GTM only, remove `NEXT_PUBLIC_GA_ID`.
- Statuses: GTM not started; GA4 not started; Google Ads not started; Meta Pixel not started; consent not started. Nothing here is "operational".

## Proposed architecture (needs approval and your accounts)
1. **One GTM container** loaded once in the root layout from `NEXT_PUBLIC_GTM_ID`; separate IDs for staging/production; loaded only after consent state is initialised.
2. **Consent**: first-party banner (necessary / analytics / marketing, accept, reject, change later, withdraw). Google Consent Mode v2 defaults to `denied` for `ad_storage`, `ad_user_data`, `ad_personalization`, `analytics_storage`, updated on choice; choice stored in a first-party cookie. Meta and Ads tags fire only on marketing consent.
3. **Typed dataLayer module** (`src/lib/analytics`): one `track()` helper, clears `ecommerce` before each push, INR everywhere, `item_id` = variant SKU, prices in rupees (paise/100).
4. **Events**: view_item_list, select_item, view_item, search, add_to_wishlist, add_to_cart, remove_from_cart, view_cart, begin_checkout, add_shipping_info, add_payment_info, purchase, refund (GA4 names; Meta mapping via GTM: ViewContent, Search, AddToCart, InitiateCheckout, AddPaymentInfo, Purchase).
5. **Purchase accuracy**: the order page renders the purchase push only when the server says the order is paid, with `transaction_id = orderNumber`, and records a `purchaseTrackedAt` flag on the order so refreshes and revisits cannot re-fire it (guest and customer pages). Refund event fires from the admin refund result path server-side data (GA4 Measurement Protocol is the reliable option).
6. **Google Ads**: import GA4 `purchase` as the conversion **or** use a separate Ads tag, not both. Recommendation: Ads conversion tag in GTM with transaction_id for dedupe, GA4 purchase kept for reporting; Enhanced Conversions only with marketing consent and SHA-256 hashing done in GTM.
7. **Meta**: browser Pixel via GTM now; Conversions API later with a shared `event_id` for dedupe. No raw phone/email sent.
8. **Other services**: Search Console and domain verification (free, do first); Merchant Center feed (product feed route is straightforward from the catalogue, needs GTIN/availability data); Clarity optional; email/WhatsApp notifications once a provider is chosen (SMTP env vars exist but unused). Skip Hotjar and a CRM until there is a use case.

## Inputs needed from you
GTM container IDs (prod/staging), GA4 property, Google Ads conversion ID/label, Meta Pixel ID, domain, and whether you operate outside India (affects consent defaults).
Validation (Tag Assistant, GA4 DebugView, Meta Events Manager) needs those accounts; it cannot be done from this repo alone.
