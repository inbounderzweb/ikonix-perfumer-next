# Functional testing: what was and was not tested

## Tested (this and earlier sessions, local, test mode)
| Area | Result |
|---|---|
| Customer mobile-OTP signup/login/logout, 30-day config, sign-out everywhere | Pass (browser + 47-check script) |
| Profile edit, address CRUD/default, wishlist, orders list/detail/filter/search, tracking timeline, invoice PDF, reorder | Pass (script + browser); ownership/IDOR checks pass |
| Admin to customer status flow (status change + message + courier shows on customer order) | Pass (browser) |
| Guest checkout choice, guest invoice by token | Pass (browser/curl) |
| Stock reserve/consume/release, races, expiry, late payment, signatures | Pass (13-check payment suite; needs the `zz-test-perfume` product re-created to re-run) |
| Razorpay modal opens in test mode with server-computed total | Pass |
| Admin: login, all pages load, product create, media upload/validation, Cloudinary, delivery methods | Pass (earlier) |
| `tsc`, `eslint`, `next build`, `npm audit`, `ikonix:verify` | Pass |
| Phone-width overflow on account, login, checkout pages | Pass |

## Not tested
Completing a real card/UPI payment, refunds end to end, live webhook (no secret), Google OAuth with real Google, admin pages at phone width, cross-browser/Safari, accessibility with a screen reader, load testing, backup/restore.

## Bugs and gaps found
| ID | Sev | Finding |
|---|---|---|
| F-01 | High | **Wishlist product links are broken.** `components/account/wishlist-grid.tsx` links to `/product-details/<slug>`, but that route expects a numeric legacy id and redirects to `/shop`. Should link to `/products/<slug>`. (Introduced by my earlier work.) |
| F-02 | Medium | Missing customer features from the spec/audit list: **cancellation and return requests**, coupons (model fields only; no admin or checkout UI), reorder merges into the existing cart instead of replacing it. |
| F-03 | Medium | Missing admin features: category/brand management, coupon management, banner/CMS management, reports, exports (CSV), refund UI (removed at your request earlier). |
| F-04 | Medium | No customer/admin notifications (email/WhatsApp/SMS) for order events. |
| F-05 | Low | Contact form uses `mailto:` (no server record, spam-proof but unmeasurable). |
| F-06 | Low | Offer, packing and tax rules from the legacy backend are still not applied. |
