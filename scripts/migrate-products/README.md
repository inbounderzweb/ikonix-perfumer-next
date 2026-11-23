# Catalogue migration (public folder -> MongoDB + Cloudinary)

The migration itself was built and run earlier as separate, idempotent scripts. This folder adds the independent
verification and the runbook. **Nothing here deletes anything from `public/ikonix/`.**

| Step | Command | What it does |
|---|---|---|
| 0. Backup | `mongodump --uri "$MONGODB_URI" --out ../ikonix-backup-$(date +%F)` | Full backup before touching a database that already has data |
| 1. Source audit | `public/ikonix/export/extraction-report.json` | Produced by the extractor (`scripts/ikonix-extract`): totals, failed downloads, duplicate content, missing fields |
| 2. Database setup | `npm run ikonix:setup-db` | Collections, validators and indexes |
| 3. Products | `npm run ikonix:import` | Upserts by `legacyId` (413 products, variants keep legacy ids, SKUs `IKX-{id}-{size}`); stock rows insert-only; invalid source values are kept and the product is imported as DRAFT with `reviewIssues` |
| 4. Images | `npm run ikonix:migrate-images` | Uploads `public/ikonix/products/**` to Cloudinary (`ikonix/products/{slug}/...`), dedupes by SHA-256, resumable, never deletes local files |
| 5. Verify | `npx tsx scripts/migrate-products/verify-migration.ts` | Compares source vs MongoDB (names, slugs, descriptions, categories, variants, prices in paise, images byte-for-byte by SHA-256) and HTTP-checks every image URL. Writes `audit/migration-report.{json,md}` |
| 5b. Integrity | `npm run ikonix:verify` | Database rules (validators, stock races) |
| 6. Copy to another DB | `npm run ikonix:copy-catalogue -- --dry-run` then without the flag | Copies the catalogue from local to the database in `MONGODB_URI` (e.g. Atlas). Re-run step 5 against it |

## Rollback
1. **Database:** restore the step-0 dump (`mongorestore --uri "$MONGODB_URI" --drop ../ikonix-backup-<date>`), or for a brand-new database simply drop the catalogue collections (`products`, `inventory`, `brands`, `categories`, `collections`, `media_assets`). The import is idempotent, so a partial run can also just be re-run.
2. **Cloudinary:** images live under `ikonix/products/` (and the media library under other `ikonix/*` folders). They can be left in place (re-running skips them). Delete only after written approval and only after confirming no product references them (`media_assets` is the reference list).
3. **Public folder:** untouched. Remove it only after manual approval once step 5 shows zero unexplained discrepancies in production.
4. **Traffic:** keep the old database in `.env` (commented) until the new one passes step 5.
