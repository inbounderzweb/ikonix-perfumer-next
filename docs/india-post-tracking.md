# India Post automated shipment tracking

**Status: built and tested against a local stand-in only. Not production-ready.** No request has ever been sent to India Post from this code: that needs your integration Customer ID, a whitelisted static IP and CEPT's confirmation of the open points in section 9.

Staff still book parcels and type the consignment number by hand. Everything after "Shipped" can now update itself.

Source used for formats: CEPT, *DoP Integration with Bulk Customers*, version 9 (10.11.2021), read from the [Internet Archive copy](https://web.archive.org/web/20220601115842/https://cept.gov.in/apiintegration/pdf/DOP_Bulk%20Customer%20Integration_v9.pdf), and the [onboarding SOP](https://utilities.cept.gov.in/dop/pdfbind.ashx?id=5778). Ask CEPT for the current version.

## 1. Architecture

```
Admin "Shipped" + consignment ──► Order.shipments[] (tracking queue = enabled + next check due)
worker  or  cron endpoint  or  admin button
        └─► runTrackingCycle()  ── one database lock, one run at a time
              ├─ Bulk XML adapter     (one file per day, many parcels)
              └─ Article API adapter  (one parcel per request, rate limited)
                    └─► shipment_events ─► shipment status ─► order status ─► customer email/SMS
```

| Part | File |
|---|---|
| Shared statuses, consignment check | `src/lib/shipment-tracking.ts` |
| Settings, URL allow-list, state | `src/server/shipping/india-post/config.ts` |
| HTTP, error classes | `…/india-post/http.ts`, `errors.ts` |
| Adapters | `…/india-post/bulk-xml.ts`, `article-api.ts` |
| Event code mapping, IST dates | `…/india-post/events.ts`, `dates.ts` |
| Service and connection test | `…/india-post/service.ts` |
| Queue, idempotent events, order updates | `src/server/shipping/tracking/shipments.ts` |
| Cycle, retries, checkpoints, lock | `…/tracking/engine.ts`, `lock.ts` |
| Dashboard queries | `…/tracking/dashboard.ts` |

Another courier needs its own adapter producing the same normalised events. The engine and settings are currently wired to India Post and would need a small provider switch.

### Behaviour

- **Bulk XML:** downloads the Latest Event (`LE`) file per day, from the earliest active shipment (minus the look-back) up to today, never more than 30 days back. A day downloaded after it closed (plus "settle" hours) is final and not requested again. An unchanged file is not reprocessed. A consignment entered late causes the affected days to be read once more.
- **Article API:** requests only parcels that are due, in batches, at the configured rate. Interval depends on status (in transit, out for delivery, on hold or failed attempt).
- **Status:** derived from the whole event history, so late or repeated events cannot move a parcel backwards. The first final event (delivered, returned, cancelled) wins and ends tracking.
- **Order updates** (optional): out for delivery, delivery failed, delivered, returned. Only orders still on their way are changed; a status staff set later is not overwritten by older events. Returned parcels are **not** restocked or refunded automatically.
- **Failures:** access (401/403), configuration (404/405/redirect) and rate-limit (429) answers stop the run without using up retries. Network and 5xx errors back off exponentially up to the retry limit, then wait for "Retry failed".

### Event mapping

| India Post code | Status | Order |
|---|---|---|
| ITEM_BOOK, ITEM_PICKUP | Booked | unchanged |
| BAG_*, ITEM_BAGGING, ITEM_DISPATCH, ITEM_RECEIVE, TMO_RECEIVE, ITEM_MISSENT, ITEM_REDIRECT, CUSTOMS_IN, CUSTOM_RECEIVE, CLEAR_CUSTOMS | In transit | unchanged |
| BEAT_DISPATCH (our reading: confirm) | Out for delivery | Out for delivery |
| ITEM_ONHOLD, CUSTOM_HOLD, CUSTOM_RETURN | On hold | unchanged |
| ITEM_NONDELIVER | Delivery attempt failed | Delivery failed |
| ITEM_DELIVERY | Delivered | Delivered |
| ITEM_RETURN | Returned | Returned |
| ITEM_CANCEL | Cancelled | unchanged |
| anything else, including BEAT_DELIVERY | history only | unchanged |

## 2. Database changes (MongoDB, additive)

`orders.shipments[]` gains: `trackingEnabled`, `trackingEnrolledAt`, `trackingBackfillPending`, `lastTrackingCheckAt`, `nextTrackingCheckAt`, `lastEventAt`, `lastEventCode`, `lastEventDescription`, `lastEventOffice`, `statusEventKey`, `trackingError`, `retryCount`, `trackingFailed`. The existing `status` field is the shipment status and accepts the new values; `trackingNumber`, `carrier` (`INDIA_POST`), `shippedAt`, `deliveredAt` and `createdAt` are reused. The parent order is the `orderId`.

Indexes on `shipments.trackingNumber`, `shipments.status`, and `shipments.trackingEnabled + nextTrackingCheckAt`.

New collections: `shipment_events` (`_id` is a hash of the event, which makes inserts idempotent), `tracking_sync_logs` (kept 90 days), `tracking_sync_files` (per-day checkpoints), `job_locks`. Settings are two documents in `settings`.

Recipient names, invoice numbers and amounts in the XML are not stored.

## 3. Routes

| Route | Access |
|---|---|
| `GET/POST /api/cron/india-post-tracking` | `Authorization: Bearer $CRON_SECRET` |
| `/admin/settings/shipping/india-post` | permission `tracking.configure` (super admin) |
| `/admin/tracking` | `orders.read`; actions need `orders.write` |

Admin actions are Server Actions in `src/app/actions/admin/tracking.ts` (save, test, IP lookup, sync, retry, reconcile, reset failed days, add existing shipments). Changes to `updateOrderStatus` and `postOrderUpdate` are in `actions/admin/orders.ts`. The customer tracking route is unchanged in address and now returns the courier timeline.

## 4. Background worker

Use **one** of these. Running both, or several copies, is safe.

- Long-running process: `npm run tracking:worker` (checks every minute whether work is due). Keep it alive with systemd, pm2 or your host's worker type. Stops cleanly on SIGTERM.
- System cron: `*/5 * * * * cd /path/to/app && npm run tracking:worker -- --once`
- HTTP cron: call the cron endpoint every 5 minutes. Each call works for at most about 45 s plus the request in progress; set the request timeout accordingly on serverless hosts.

## 5. Admin changes

- Marking an order Shipped with courier "India Post" (also "Speed Post", "Registered Post") now **requires** a 13-character consignment number. A check-digit or duplicate-number problem only warns. Other couriers behave as before.
- Order page: shipment status, courier history, last check, error, "Check now".
- New pages: "Shipment tracking" and "India Post settings" (also linked from Delivery).
- Settings can only be switched on after a connection test passes for exactly those settings.

## 6. Environment variables

| Variable | Needed | Purpose |
|---|---|---|
| `CRON_SECRET` | for HTTP cron | at least 16 random characters |
| `INDIA_POST_AUTH_SECRET` | only if CEPT issues a key, token or password | never stored in the database |
| `INDIA_POST_AUTH_USERNAME` | only for Basic authentication | |
| `INDIA_POST_ALLOWED_HOSTS` | no | extra `host[:port]` values besides `*.cept.gov.in` and `*.indiapost.gov.in`; leave empty in production |
| `INDIA_POST_IP_ECHO_URL` | no | outbound IP lookup service (default `https://api.ipify.org`) |

The worker needs the same `.env` as the web app (database, email, SMS).

## 7. Deployment

1. Back up the database.
2. Deploy the code and run `npm install` (new dependency: `fast-xml-parser`).
3. Run `npm run ikonix:setup-db` against the production database. It builds the new indexes. It also syncs every model's indexes and drops ones no longer declared, so read its output.
4. Set the environment variables, `npm run build`, restart the web app.
5. Get a **static outbound IP** for every machine that calls India Post (web app, for tests and manual sync, and worker). Cloud and serverless hosts often rotate addresses; use a NAT gateway or fixed-IP server and verify with "Look up outbound IP".
6. Start the worker or cron.
7. In India Post settings: enter the details, save, "Test connection", then enable.
8. On the tracking dashboard, "Add existing shipments" for orders already on their way. This can send delivery notifications for them.
9. Compare the first days of results with the India Post website before relying on automatic order updates (they can be switched off while checking).

## 8. Test results (26 November 2026)

| Check | Result |
|---|---|
| `npm run tracking:test` (local database, local stand-in) | 35 passed |
| TypeScript, production build | passed |
| ESLint | no findings in new or changed files; 1 error and 2 warnings remain in two untouched files |
| Browser, local: configure, test, enable, mark shipped, sync twice, admin and customer views, 375 px width | passed |
| Browser, local: manual flow with another courier (shipped, out for delivery, delivered) | passed |
| Worker single run and start/stop; cron endpoint rejects missing or wrong secret | passed |

| Requested scenario | Covered by |
|---|---|
| 1, 2 mark shipped, number saved | browser |
| 3 worker finds eligible shipments | test script |
| **4 bulk download with real credentials** | **not tested: no credentials** |
| 5–10 parsing, multi-update, duplicates, old events, delivered excluded, retries | test script, against sample XML built from the published schema |
| 11 concurrent workers | test script |
| 12, 13 customer timeline, manual sync | browser |
| 14 manual shipping still works | browser |

Not exercised: live India Post, real email or SMS delivery, the outbound IP lookup, a real CEPT article API format, the older customer and payment test scripts.

## 9. Pending India Post onboarding

Request API integration through your Circle or Division sales contact (an HDMS ticket), giving your Customer ID and static public IP. CEPT's published contact is `salesndist.cept@indiapost.gov.in`.

Obtain and confirm:

1. The 10-digit integration Customer ID (do not assume the receipt number).
2. IP whitelisting for your static address.
3. That `LE` outbound files are enabled for your account.
4. `Event_Date` format: the specification says `dd/mm/yyyy` but shows `05032021`.
5. That parameters go in the query string of a GET request (the specification lists the names and says to use GET).
6. Whether the download is available over **https**. The published URL is http, and the files contain recipient names.
7. **Whether `LE` files include returns.** Version 6.1 said they exclude the returned (`RT`) event. If so, returns will be missed until an `RT` adapter is added, which needs its XML format.
8. Whether a returned parcel delivered back to you can appear as `ITEM_DELIVERY` without an earlier `ITEM_RETURN`. That would be recorded as delivered to the customer.
9. The meaning of `BEAT_DISPATCH`, `CUSTOM_RETURN` and `ITEM_CANCEL`.
10. How often files are regenerated. Each file holds only the latest event per article, so scans between downloads can be missing from the timeline.
11. For the article API: request and response format, authentication, rate limits, and whether bulk requests exist.
