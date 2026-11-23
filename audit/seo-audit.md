# SEO audit

Checked on the production build with `curl` and Lighthouse SEO (home 92, shop 100, product 100).

| ID | Sev | Finding | Fix |
|---|---|---|---|
| SEO-01 | Medium | Home page has **no `<h1>`** and no canonical link. | Add one h1 and `alternates.canonical`. |
| SEO-02 | Medium | `robots.txt` does not block `/admin`, `/checkout`, `/login`, `/order/` (see S-06). | Extend rules plus `noindex` metadata. |
| SEO-03 | Medium | Product `og:image` points at the **old** Cloudinary account (`iombhcei`) while `.env` now targets a different account. If that account is closed the social previews and structured-data images break. | Resolve the open image-account decision (migrate or revert). |
| SEO-04 | Medium | No `Organization` / `WebSite` (sitelinks search) JSON-LD. Product JSON-LD exists with name, image, brand, SKU, offers, availability, breadcrumb, but lacks `itemCondition`, `priceValidUntil`, shipping/return details (needed for Merchant listings). | Add; no `aggregateRating` until real reviews exist (none do, correctly omitted). |
| SEO-05 | Low | `/shop?page=2` canonicalises to `/shop`; fine for thin pagination but combined with P-03 consider `rel=prev/next` free approach: self-canonical per page. | Decide per catalogue size. |
| SEO-06 | Low | Sitemap lists home, shop, about, contact and all 395 active products (399 URLs); `lastmod` only on products; category URLs not present. | Add category pages once they exist. |
| SEO-07 | Low | Canonicals and sitemap use `NEXT_PUBLIC_SITE_URL`, currently `http://localhost:3000`. | Must be `https://ikonixperfumer.com` in production. |
| SEO-08 | Info | Unknown product slug returns real 404; legacy `/product-details/:pid` 301-redirects to slug URLs (migration preserved). Images all have alt text. | None. |
