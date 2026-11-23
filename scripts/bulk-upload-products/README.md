# Bulk product upload

Creates products from the product export (`public/ikonix/export/all-products.json`) and the image
folders under `public/ikonix/products/<slug>/images/`, through the application's own product service.

The same code also powers **Admin → Products → Bulk upload** (`/admin/products/bulk`).

## Guarantees

- **One write path.** Products are created by `saveProductRecord` (`src/server/catalogue/product-service.ts`), the same function the admin product form uses. Every bulk product gets the same:
  - validation
  - price rules (sale ≤ MRP, money stored in paise)
  - SKU and slug uniqueness
  - inventory rows
  - audit log entry (`product.create`)
- **No duplicates, no overwrites.** Before anything is uploaded, each product is checked against the target by four keys: legacy id, slug, every SKU and every legacy size id. A match is reported as `exists` and is never modified. The database's unique indexes catch races between parallel runs.
- **No duplicate images.** Images go through `storeImage` (the media library upload). Identical bytes (SHA-256) are stored once, so retries and re-runs reuse earlier uploads.
- **All or nothing per product.** A product is created only after all of its images are stored. A failed product leaves no partial record and is safe to retry.
- **Original data is kept as it is.** Mapping rules are the same as the original importer:
  - legacy categories mens / women's / unisex map to categories
  - "best sellers" maps to collection membership
  - a size whose price is missing or above MRP is kept but switched off
  - any data issue makes the product a DRAFT, with `reviewIssues` explaining why
- **Source files are never changed.** Images are only read from `public/`.
- **Safe target.** The scripts refuse to run when:
  - `MONGODB_URI` is a local database (unless you pass `--allow-local`)
  - `CLOUDINARY_CLOUD_NAME` is not `iombhcei` (override with `BULK_EXPECT_CLOUD`)

### Cloudinary public ids

New images use the media library's existing convention: `ikonix/products/<slug>-<file>-<sha10>`. This is not the `products/{id}/main` layout. The content-hash suffix is what makes uploads idempotent, and changing it would re-upload images that are already stored. Order (main, gallery, then each size's photo) and the size links are kept on the product record.

## Admin sign-in

The scripts that write sign in with an admin account, using the same password and role rules as `/admin/login`. Set the credentials in the environment or in `.env.local`. They are never hard-coded or printed.

```
BULK_ADMIN_EMAIL=...
BULK_ADMIN_PASSWORD=...
```

The account needs the `products.write` and `media.write` permissions (Super admin or Product manager).

## Steps

Run every script with the react-server condition, which makes the `server-only` guard a no-op outside Next.js. The npm scripts set it for you.

| Step | Command | Writes |
|---|---|---|
| 1. Scan source data and images, and check the target (read-only) | `npm run bulk:scan` | `audit/bulk-upload/scan-report.json` |
| 2. Upload images of products not yet on the target | `npm run bulk:upload-images` | Cloudinary + `media_assets`, `upload-manifest.json` |
| 3. Create the products | `npm run bulk:create` | products, inventory, audit log, `create-report.json` |
| 4. Verify every product and image against the source | `npm run bulk:verify` | `verify-report.{json,md}` |

Step 2 is optional, because step 3 uploads any image that is not stored yet. Running it first separates upload problems from data problems.

### Flags

| Flag | Scripts | Effect |
|---|---|---|
| `--dry-run` | upload, create | Validate everything and write nothing |
| `--only=86,87` | all | Limit the run to these legacy ids |
| `--retry-failed` | create | Re-run only the products that failed in the last `create-report.json` |
| `--concurrency=N` | upload, create | Number of parallel uploads (defaults: upload 4, create 3) |
| `--source=path.json` | all | Use another data file in the same format |
| `--skip-http` | verify | Skip the HEAD requests to image URLs |

### Resuming

Every step can be re-run. Existing products are skipped and stored images are reused, so after an interruption run the same command again, or `npm run bulk:create -- --retry-failed`.

### Rollback

A run only adds records. Each created product is listed in `create-report.json` with its `productId`, and has a `product.create` audit entry (`after.via = "bulk-import"`). To undo, archive those products in the admin panel. Archive rather than delete, because orders may reference them.
