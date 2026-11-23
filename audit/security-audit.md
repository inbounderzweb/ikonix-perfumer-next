# Security audit (OWASP Top 10 / API Top 10 baseline)

Severity scale: Critical, High, Medium, Low, Info. "Verified" means exercised by a test or request in this audit.

## Findings
| ID | Sev | Where | Finding | Impact | Fix |
|---|---|---|---|---|---|
| S-01 | High | `.env` (untracked) | Live legacy-site credentials (`API_BEARER_TOKEN`, `API_COOKIE`) sit in the app's env file; used only by the one-off scraper in `scripts/ikonix-extract`. | Any process or leak of `.env` also exposes a third-party session. | Remove from `.env` (pass to the script at run time) and rotate with the legacy provider if it is still live. |
| S-02 | High | `.env`, `/api/webhooks/razorpay` | `RAZORPAY_WEBHOOK_SECRET` empty, so the webhook returns 503. A customer who pays and closes the tab before the return handler runs is not confirmed until the webhook works. | Paid-but-unconfirmed orders; manual refunds. | Create the webhook in Razorpay, set the secret, run a test event. |
| S-03 | High | `.env` | Admin owner password stored as plain `ADMIN_PASSWORD`. The code already supports `ADMIN_PASSWORD_HASH`. `SESSION_SECRET` is weak and unused. | Credential exposure if `.env` leaks. | Use a bcrypt hash; delete the unused secret. |
| S-04 | Medium | `/api/search/suggest`, `getCartView`, `/product-details/[pid]` | Public endpoints with no rate limit; search is an unanchored case-insensitive regex over `name`, `inspiredByName`, `variants.sku` (collection scan). | Cheap DoS / DB load. | Rate-limit per IP, add a text or prefix index, cap request size. |
| S-05 | Medium | `next.config.ts` CSP | `script-src 'unsafe-inline'` (needed because pages are cached without nonces). GTM/GA/Meta will need additional script/connect/img sources. | Weaker XSS containment; CSP will break tags if not updated. | Decide: nonce-based CSP via proxy (dynamic pages) or tight allowlist for the tag domains. |
| S-06 | Medium | `src/app/robots.ts` | Disallows only `/account` and `/api/`; `/admin`, `/checkout`, `/login`, `/order/` are not listed (admin already sends noindex headers). | Crawl waste, private-ish URLs in indexes. | Extend disallow list and add noindex metadata. |
| S-07 | Medium | Admin auth | No MFA for staff. `ADMIN_STEP_UP` OTP purpose exists in the model but is unused. | Single factor on the most privileged accounts. | Add TOTP or OTP step-up for admin and refunds. |
| S-08 | Medium | Observability | No error monitoring, 20 raw `console.*` calls, no alerting on payment failures. | Silent failures in production. | Sentry plus structured logger with redaction; alerts on webhook/payment errors. |
| S-09 | Low | MongoDB | Local instance has no authentication (bound to localhost). Backups are not configured. | Fine for local dev; unacceptable for production. | Production cluster with auth, TLS, least-privilege user, scheduled backups, restore drill. |
| S-10 | Low | Data retention | Account deletion is a request only; no retention/erasure job or data-export. | Privacy-law exposure (DPDP Act). | Define retention; add an admin workflow that anonymises PII but keeps transaction records. |
| S-11 | Low | Git | Build artefacts tracked (`tsconfig.tsbuildinfo`, `next-env.d.ts`). | Noise. | `.gitignore` plus `git rm --cached`. |
| S-12 | Info | OTP | Mock provider is active; the code refuses it when `NODE_ENV=production`. | Expected. | Integrate MSG91/Twilio before launch. |

## Controls verified working
- Auth: opaque random session tokens in `__Host-` HttpOnly Secure SameSite=Lax cookies; only SHA-256 stored; server-side revocation (logout, logout-others, logout-all); no tokens in localStorage; suspended users lose access immediately. OTP: HMAC with pepper, atomic attempt claim, single use, expiry, resend cooldown, per-number and per-IP limits (47-check suite). Account enumeration avoided on OTP request.
- Google OAuth (code): Authorization Code + PKCE + state + nonce, ID-token verified against Google JWKS, verified-email-only linking, never grants admin. **Not tested against real Google** (no credentials).
- Access control: every admin action calls `requireAdmin(permission)` (13 of 13 exported actions); all admin pages sit behind a guarded layout; customer queries always include the session user id (IDOR tests for addresses, orders, wishlist, invoice, tracking all return not-found for other users); client-supplied user ids ignored; profile schema is `.strict()`.
- Payments: server-side repricing, HMAC signature check, payment re-fetch from Razorpay (status, amount, currency), webhook HMAC on raw body, event-id dedupe, atomic order claim, stock reserve/consume/release (13-check suite incl. 8-way race with no oversell).
- Uploads: content-sniffed type, 10 MB and pixel caps, SVG rejected, sha256 dedupe, same-origin check, rate limit.
- Headers (production build): CSP, HSTS (preload), nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP; `X-Powered-By` removed; CSRF via Origin check for server actions and `assertSameOrigin` for cookie-authenticated routes.
- Secrets: pattern scan of `src`, `scripts`, `docs`, `README`, public logs found none; `.env` is git-ignored and not tracked.
- `npm audit`: 0 vulnerabilities.

## Not tested
Active scanning (ZAP/Burp), XSS in the Tiptap-rendered content path, SSRF (no outbound fetch of user URLs exists in code reviewed), load/DoS testing, real Razorpay card flow, refunds end to end.
