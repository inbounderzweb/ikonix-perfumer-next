# Legacy (PHP/MySQL) -> MongoDB migration

Imports customers, saved addresses, paid/confirmed/delivered orders and Razorpay payment references from the old
site's `ikonix.sql` dump so existing customers can sign in by OTP with the same mobile number and see their history.

The dump holds customer data and password hashes. Keep it outside the repo (`*.sql` is gitignored).

## Commands

```bash
# 1. Dry run (default). Writes NOTHING. Reads MongoDB only to match existing records.
npm run legacy:dry-run
npm run legacy:dry-run -- --dump=/path/to/ikonix.sql
# -> scripts/legacy-migration/reports/dry-run-<time>.md (+ .json). Prints a plan fingerprint.

# 2. Take an Atlas backup / export and confirm you can open it. Then, only after the report is approved:
LEGACY_MIGRATION_APPROVED=yes npm run legacy:execute -- \
  --confirm-db=<database name> --approved-fingerprint=<fingerprint from the report> --backup-verified

# 3. Rollback (removes only documents with legacy.source = ikonix-mysql-2026-11)
LEGACY_MIGRATION_APPROVED=yes npm run legacy:rollback -- --confirm-db=<database name> --backup-verified
```

Execute refuses to run unless all four gates pass: env approval, matching DB name, `--backup-verified`, and a
fingerprint equal to the plan it is about to write (so it can only write what was reviewed).

## Rules the importer follows

- **Customers:** only people with a valid mobile. Existing Mongo customers (same normalised mobile) are never modified.
  Not imported: passwords, `client_secret`, `mvercode`, OTP rows, email-only accounts, test/team accounts.
- **Orders:** imported only if a successful `paylog` row exists, or status is confirmed/delivered. Excluded: abandoned
  checkouts, users 22/24, team number 8139886630, orders with subtotal <= ₹1, names like "Test".
  Number = `IKX-L-<legacy id, 6 digits>`; original id/status/address text kept in `order.legacy`.
- **Total** = sum(qty x price of paid rows) + delivery charge. Free-unit rows (price 0) become `freeQuantity` on the matching line.
- **Products:** linked by slug + size + the product name on the order line. Legacy variant ids are not used (they were
  re-keyed in the old DB). Products that no longer exist stay as snapshot-only lines (`snapshotOnly: true`).
- **Payments:** the old `paylog` stores no amount, no method and no Razorpay order id. Payment documents carry the
  `pay_...` id, `amount` = reconstructed order total, and `providerOrderId` = `legacy-order-<id>` (a placeholder).
- **Safety:** imported orders are read-only. Admin write actions, payments and notifications only accept the
  `IKX-YYMMDD-NNNNN` format, so a legacy order can never be refunded, re-notified or re-paid. No SMS/email/webhook code
  is called by the importer.
- Timestamps in MySQL have no timezone; they are read as IST (+05:30).

## Cut-over

Re-export the dump just before go-live and run again. Orders are refreshed from the newer dump (`$set`), customers,
addresses and payments are insert-only. New legacy orders placed after this dump are picked up the same way.
