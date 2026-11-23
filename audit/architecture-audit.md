# Architecture and folder structure audit

## Shape (141 TS/TSX files, about 8.4k lines)
- `src/app/(store)`: storefront pages; `src/app/admin`: admin (separate layout and auth); `src/app/api`: 12 route handlers; `src/app/actions`: server actions (`admin/*`, `customer/*`, `cart`, `checkout`).
- `src/server/*`: domain logic (`auth`, `commerce`, `customer`, `admin`, `catalogue`, `media`, `models`). `src/components/{store,account,admin}`: UI. `src/lib`: shared pure helpers.
- Data: MongoDB single-node replica set (transactions available), Mongoose models via `defineModel`, money in integer paise.

## Assessment
Good: business logic lives in `src/server`, not in components; storefront, account and admin are separated by route group and by `components/*`; the proxy is only an optimistic cookie gate and every page/action re-checks auth on the server; webhook, payment, stock and order logic are isolated in `server/commerce`.

Findings:
| ID | Sev | Finding |
|---|---|---|
| A-01 | Low | `inr`/`rupees` money formatters exist in 3 places (`lib/format.ts`, `lib/catalogue-types.ts`, `checkout-client.tsx`) with different semantics (paise to string vs paise to rupees number). Consolidate. |
| A-02 | Low | Actions files are mixed: `"use server"` files may only export async functions (already bitten once; constants now in `server/commerce/order-flow.ts`). Add a lint rule or convention note. |
| A-03 | Low | `tsconfig.tsbuildinfo` and `next-env.d.ts` are tracked in git; should be ignored. |
| A-04 | Info | `scripts/ikonix-extract` (legacy scraper) needs a bearer token and cookie in `.env`; keep out of the app environment (see S-01). |
| A-05 | Info | No automated test runner; the two integration scripts are the only tests (`scripts/ikonix/test-*.ts`). No CI. |
| A-06 | Medium | No analytics/marketing layer exists (see `marketing-integrations.md`). |

No circular dependencies or never-imported source files were found (script-based check). No unused runtime dependency found. Folder moves are **not** recommended; the structure is already consistent.
