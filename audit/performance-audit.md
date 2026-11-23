# Performance audit (measured)

Setup: production build (`next build` + `next start`), Lighthouse 12, mobile profile (4x CPU slowdown, simulated slow 4G), localhost, headless Chrome, single run per page. Numbers vary run to run; treat as indicative. "Before" only: nothing has been optimised yet.

| Page | Perf | LCP | TBT | CLS | FCP | Transfer |
|---|---:|---:|---:|---:|---:|---:|
| `/` | 52 | 10.6 s | 610 ms | 0 | 1.5 s | 19.8 MB |
| `/shop` | 71 | 4.2 s | 580 ms | 0 | 1.2 s | 18.5 MB |
| `/products/<slug>` | 0 (Lighthouse recorded no LCP) | n/a | n/a | 0 | 1.2 s | 18.5 MB |

Targets: LCP <= 2.5 s, INP <= 200 ms (lab proxy: TBT), CLS <= 0.1, Lighthouse >= 90. CLS passes. INP was not measurable in a lab run.
Field data (CrUX) is not available for a site that is not live.

## Findings
| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| P-01 | Critical | Giant SVG assets. `public/ikonix/site/makeperfume.svg` is 14.9 MB (20.3 MB on disk, an SVG wrapping a raster), `BrandShowcaseBanner_mobile.svg` 1.9 MB, `instapage.svg` 1.0 MB, `BrandShowcaseBanner.svg` 0.85 MB. In the browser they load on **every** page (resource entries show `initiatorType: link`) because route prefetch of linked pages (About/Contact via header/footer) preloads their images. | Lighthouse network list; `curl -I` shows `Content-Length: 20278502`. | Re-export as WebP/AVIF (the about page already has `.webp` variants), serve through `next/image`, add width/height, set `prefetch={false}` on low-value links. Expect transfer to drop from about 18 MB to well under 1 MB. |
| P-02 | High | Static files in `public/` are served `Cache-Control: public, max-age=0`. | `curl -I` | Add long-lived immutable caching via `headers()` for `/ikonix/*` (use content-hashed names). |
| P-03 | High | Product and shop pages are **dynamic** (`no-store`) because they read `searchParams` (`?variant=`, filters) even though `revalidate = 300` is set. No CDN caching. | `next build` route table (`ƒ`), response headers | Make the variant a client concern (default variant server-rendered, `?variant` read on the client) so the page can be statically revalidated. |
| P-04 | High | Home LCP element is the hero slide image and is lazy-loaded (`lcp-lazy-loaded`); `unsized-images` flagged. | Lighthouse | Preload and `fetchPriority="high"` for the first slide, explicit dimensions. |
| P-05 | Medium | Main-thread work: TBT 580-610 ms. Client JS 887 KB raw / about 281 KB gz across chunks; Swiper and `motion` load on all store pages. | build output, Lighthouse | Dynamic-import carousels below the fold; audit `motion` use. |
| P-06 | Medium | Search = unanchored regex scan (see S-04). Admin lists are server-paginated (good). | code | Index + rate limit. |
| P-07 | Low | Accessibility items that also hit best-practice scores: `aria-hidden-focus`, `color-contrast`, `heading-order` (a11y 91-93). | Lighthouse | Fix with the P-01 pass. |

Backend: no N+1 patterns found in the customer/admin queries read; lists use `limit/skip` with indexes on `userId+placedAt`, status and payment status. No load test was run; connection pooling is Mongoose defaults.
