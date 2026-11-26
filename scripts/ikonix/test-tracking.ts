// Integration test of shipment tracking against a LOCAL database and a local stand-in for India Post.
// It never contacts CEPT: passing here does not prove the live integration works.
//   npm run tracking:test        (uses mongodb://127.0.0.1:27017/ikonix_tracking_test and empties it)
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { Types } from "mongoose";

const URI = process.env.TRACKING_TEST_MONGODB_URI ?? "mongodb://127.0.0.1:27017/ikonix_tracking_test";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/\w*test\w*(\?.*)?$/.test(URI)) throw new Error("The tracking test only runs against a local database whose name contains 'test'.");
process.env.MONGODB_URI = URI; // set before .env is loaded: loadEnvConfig never overrides
for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "EMAIL_ADMIN_TO"]) process.env[k] = ""; // no real mail
process.env.OTP_PROVIDER = "mock";

let n = 0;
const ok = (m: string) => { n++; console.log("  ✓", m); };

// ── Stand-in for India Post ────────────────────────────────────────────────
type Rec = { number: string; code: string; day: string; time?: string; desc?: string };
const files = new Map<string, Rec[]>(); // DDMMYYYY → records
const articles = new Map<string, { status: number; events?: Record<string, string>[] }>();
const hits: { path: string; method: string; query: Record<string, string>; auth?: string; body: string }[] = [];
let forced: number | null = null;
const ddmmyyyy = (day: string) => day.split("-").reverse().join("");
const xml = (rows: Rec[]) => `<?xml version="1.0" encoding="UTF-8"?><LatestEventDetails>${rows.map((r) => `<ArticleDetails><ArticleNumber>${r.number}</ArticleNumber><ReceiverName>SECRET RECEIVER</ReceiverName><EventCode>${r.code}</EventCode><EventDescription>${r.desc ?? r.code} &amp; more</EventDescription><EventOfficeFaciltyID>PO01</EventOfficeFaciltyID><EventOfficeName>Test S.O</EventOfficeName><EventDate>${ddmmyyyy(r.day)}</EventDate><EventTime>${r.time ?? "101500"}</EventTime><NonDelReason/></ArticleDetails>`).join("")}</LatestEventDetails>`;
const bodyOf = async (req: IncomingMessage) => { let b = ""; for await (const c of req) b += c; return b; };
const server = createServer(async (req, res) => {
  const u = new URL(req.url!, "http://x");
  const body = await bodyOf(req);
  hits.push({ path: u.pathname, method: req.method!, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization, body });
  if (forced) { res.writeHead(forced, forced === 302 ? { location: "http://example.invalid/" } : {}).end(); return; }
  if (u.pathname === "/download") {
    const rows = files.get(u.searchParams.get("Event_Date")!);
    if (!rows) { res.writeHead(204).end(); return; }
    res.writeHead(200, { "content-type": "application/xml" }).end(xml(rows)); return;
  }
  if (u.pathname === "/article") {
    const a = articles.get((JSON.parse(body) as { ref: string }).ref) ?? { status: 200, events: [] };
    res.writeHead(a.status, a.status === 429 ? { "retry-after": "900" } : {}).end(a.status === 200 ? JSON.stringify({ data: { history: a.events } }) : ""); return;
  }
  res.writeHead(404).end();
});

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.INDIA_POST_ALLOWED_HOSTS = new URL(base).host;
  await import("./_env");
  const { db } = await import("../../src/server/db");
  const m = await import("../../src/server/models");
  const cfgMod = await import("../../src/server/shipping/india-post/config");
  const { IndiaPostTrackingService: svc } = await import("../../src/server/shipping/india-post/service");
  const { parseLatestEventXml } = await import("../../src/server/shipping/india-post/bulk-xml");
  const { parseEventTime, istDay, addDays } = await import("../../src/server/shipping/india-post/dates");
  const sh = await import("../../src/server/shipping/tracking/shipments");
  const { runTrackingCycle, LOCK_NAME } = await import("../../src/server/shipping/tracking/engine");
  const { acquireLock } = await import("../../src/server/shipping/tracking/lock");
  const { dashboard } = await import("../../src/server/shipping/tracking/dashboard");
  const { getOrderTrusted } = await import("../../src/server/customer/orders");
  const { checkConsignment, isIndiaPostCarrier } = await import("../../src/lib/shipment-tracking");
  await db();
  const clear = () => Promise.all([m.Order.deleteMany({ orderNumber: /^IKX-000000-/ }), m.ShipmentEvent.deleteMany({}), m.TrackingSyncLog.deleteMany({}), m.TrackingSyncFile.deleteMany({}), m.JobLock.deleteMany({}), m.Notification.deleteMany({}), m.RateLimitBucket.deleteMany({}), m.Setting.deleteMany({ _id: /^tracking\./ })]);
  await clear();

  const today = istDay(new Date());
  const d = (offset: number) => addDays(today, offset);
  const serial = (i: number) => {
    const s = String(10000000 + i);
    const sum = [8, 6, 4, 2, 3, 5, 9, 7].reduce((a, w, k) => a + w * Number(s[k]), 0);
    const c = 11 - (sum % 11);
    return `EE${s}${c === 10 ? 0 : c === 11 ? 5 : c}IN`;
  };
  let seq = 0;
  const order = async (number: string | undefined, opts: { carrier?: string; status?: string; enrol?: boolean; shippedDaysAgo?: number; shipments?: object[] } = {}) => {
    const shippedAt = new Date(Date.now() - (opts.shippedDaysAgo ?? 2) * 86_400_000);
    const cfg = await cfgMod.getConfig();
    const shipment = { carrier: opts.carrier ?? "INDIA_POST", trackingNumber: number, status: "SHIPPED", shippedAt, ...(opts.enrol === false ? {} : { ...sh.enrolmentFields(cfg, new Date(Date.now() - 1000)), nextTrackingCheckAt: new Date(Date.now() - 500) }) };
    const addr = { fullName: "Test", phone: "9999999999", line1: "1 Road", city: "Pune", state: "Maharashtra", postalCode: "411001", country: "IN" };
    const o = await m.Order.create({
      orderNumber: `IKX-000000-${String(++seq).padStart(5, "0")}`, status: (opts.status ?? "SHIPPED") as "SHIPPED", paymentStatus: "CAPTURED",
      items: [{ productId: new Types.ObjectId(), variantId: new Types.ObjectId(), sku: "T", productName: "Test", variantLabel: "30 ml", unitRegularPrice: 100, unitSalePrice: 100, quantity: 1, lineTotal: 100 }],
      subtotal: 100, grandTotal: 100, pricingSnapshot: {}, contact: { name: "Test", phone: "9999999999" }, shippingAddress: addr, billingAddress: addr, shippingMethodName: "Standard", idempotencyKey: `trk-${Date.now()}-${seq}`,
      shipments: opts.shipments ?? [shipment], statusHistory: [{ to: "SHIPPED", actorType: "ADMIN", at: shippedAt }],
    });
    return String(o._id);
  };
  type O = { status: string; deliveredAt?: Date; shipments: import("../../src/server/shipping/tracking/shipments").Shipment[]; statusHistory: { to: string; actorType: string }[]; orderNumber: string };
  const read = async (id: string) => (await m.Order.findById(id).lean()) as unknown as O;
  const events = (id: string) => m.ShipmentEvent.countDocuments({ orderId: id } as never);
  const configure = async (over: Record<string, unknown>, verify = true) => {
    const c = cfgMod.configSchema.parse({ bulkUrl: `${base}/download`, articleUrl: `${base}/article`, customerId: "1234567890", backfillDays: 1, initialDelayMinutes: 0, retryBaseMinutes: 1, maxRetries: 3, ...over });
    if (verify) Object.assign(c, { verifiedFingerprint: cfgMod.connectionFingerprint(c), verifiedAt: new Date() });
    await cfgMod.writeConfig(c, null);
    await cfgMod.patchState({ backoffUntil: null, consecutiveFailures: 0, nextRunAt: new Date(0) });
    return c;
  };
  const manual = () => runTrackingCycle({ trigger: "MANUAL", sleep: async () => {} });
  const later = (min: number) => () => new Date(Date.now() + min * 60_000);

  console.log("Validation and parsing");
  assert.equal(checkConsignment(" ee 100000014 in ").ok, true);
  assert.equal(checkConsignment("12345").ok, false);
  const good = checkConsignment(serial(1)); assert(good.ok && !good.warning);
  const bad = checkConsignment(serial(1).replace(/\dIN$/, (x) => `${(Number(x[0]) + 1) % 10}IN`)); assert(bad.ok && bad.warning);
  assert(isIndiaPostCarrier("India Post") && isIndiaPostCarrier("speed-post") && !isIndiaPostCarrier("DTDC"));
  ok("consignment format enforced, check-digit typos flagged, carrier aliases recognised");
  assert.equal(parseEventTime("5032021", "90500", "DDMMYYYY")!.at.toISOString(), "2021-03-05T03:35:00.000Z");
  assert.equal(parseEventTime("31022021", "000000", "DDMMYYYY"), null);
  assert.equal(parseEventTime("05/03/2021", "", "DD/MM/YYYY")!.day, "2021-03-05");
  ok("event dates read as India time; impossible dates rejected; dropped leading zeros restored");
  const p = parseLatestEventXml(xml([{ number: serial(1), code: "ITEM_BOOK", day: "2021-03-05" }, { number: "", code: "ITEM_BOOK", day: "2021-03-05" }]));
  assert.equal(p.events.length, 1); assert.equal(p.invalid.length, 1); assert.equal(p.events[0].eventDescription, "ITEM_BOOK & more"); assert(!JSON.stringify(p.events[0].raw).includes("SECRET"));
  assert.equal(parseLatestEventXml("<LatestEventDetails></LatestEventDetails>").records, 0);
  assert.throws(() => parseLatestEventXml('<!DOCTYPE x [<!ENTITY a "b">]><LatestEventDetails/>'));
  assert.throws(() => parseLatestEventXml("<LatestEventDetails><ArticleDetails></LatestEventDetails>"));
  assert.throws(() => parseLatestEventXml("<html></html>"));
  ok("XML parsed; bad record counted; recipient name dropped; DTD, broken and foreign documents rejected");
  const t = (s: string, m_: number) => ({ trackingStatus: s as never, eventAt: new Date(m_ * 1000) });
  assert.equal(sh.deriveStatus([t("DELIVERED", 3), t("IN_TRANSIT", 1)])!.status, "DELIVERED");
  assert.equal(sh.deriveStatus([t("RETURNED", 2), t("DELIVERED", 3)])!.status, "RETURNED");
  assert.equal(sh.deriveStatus([t("DELIVERY_ATTEMPT_FAILED", 2), t("OUT_FOR_DELIVERY", 3)])!.status, "OUT_FOR_DELIVERY");
  ok("status is order-independent; delivery of a returned parcel stays returned");

  console.log("Configuration and security");
  assert(cfgMod.urlProblem("https://evil.example/x", "NONE")); assert(cfgMod.urlProblem("https://cept.gov.in.evil.example/x", "NONE"));
  assert(cfgMod.urlProblem(cfgMod.DOCUMENTED_BULK_URL, "BEARER")); assert.equal(cfgMod.urlProblem(cfgMod.DOCUMENTED_BULK_URL, "NONE"), null);
  ok("only India Post hosts accepted; credentials refused over http");
  assert(cfgMod.configProblems(cfgMod.configSchema.parse({ customerId: "0000000000" })).length);
  assert(cfgMod.configProblems(cfgMod.configSchema.parse({ customerId: "12345" })).length);
  assert(cfgMod.configProblems(cfgMod.configSchema.parse({ mode: "ARTICLE_API" })).length);
  ok("placeholder or short Customer ID and an unconfigured article API cannot be activated");
  await configure({ enabled: true }, false);
  const unverified = await manual(); assert(!unverified.ran && unverified.reason === "UNVERIFIED"); assert.equal(hits.length, 0);
  forced = 404; await configure({ enabled: false }, false);
  const t404 = await svc.healthCheck(); assert(!t404.ok && /Customer ID/.test(t404.message)); assert.equal((await cfgMod.getConfig()).verifiedFingerprint, "");
  forced = 401; assert(!(await svc.healthCheck()).ok); assert((await cfgMod.getState()).health!.accessRejected);
  forced = 302; assert(!(await svc.healthCheck()).ok);
  forced = null; assert((await svc.healthCheck()).ok);
  const vc = await cfgMod.getConfig(); assert.equal(vc.verifiedFingerprint, cfgMod.connectionFingerprint(vc));
  assert.notEqual(cfgMod.connectionFingerprint({ ...vc, customerId: "9999999999" }), vc.verifiedFingerprint);
  ok("nothing runs until a live test passes; 404/401/redirect fail it; changing the Customer ID voids it");

  console.log("Bulk XML");
  hits.length = 0; await configure({ enabled: true });
  assert.equal((await manual() as { reason?: string }).reason, "IDLE"); assert.equal(hits.length, 0);
  ok("no active shipments → India Post is not called");
  const [A, B, C] = [serial(1), serial(2), serial(3)];
  const a = await order(A), b = await order(B), c = await order(C);
  const other = await order("X1", { carrier: "DTDC", enrol: false });
  assert.equal((await sh.queuedShipments()).length, 3);
  ok("worker discovers exactly the eligible India Post shipments");
  files.set(ddmmyyyy(d(-1)), [{ number: A, code: "ITEM_BOOK", day: d(-1) }, { number: B, code: "ITEM_DISPATCH", day: d(-1) }, { number: serial(99), code: "ITEM_DELIVERY", day: d(-1) }]);
  let r = await manual();
  assert(r.ran && r.status === "SUCCESS", JSON.stringify(r)); assert.equal(r.processed, 3); assert.equal(r.updated, 2); assert.equal(r.newEvents, 2);
  const q = hits.find((h) => h.query.Event_Date === ddmmyyyy(d(-1)))!; assert.deepEqual(q.query, { Cust_Id: "1234567890", Event_Code: "LE", Event_Date: ddmmyyyy(d(-1)) }); assert.equal(q.method, "GET");
  assert.equal(hits.length, 4); // shipped two days ago, one day of look-back, up to today
  assert.equal((await read(a)).shipments[0].status, "BOOKED"); assert.equal((await read(b)).shipments[0].status, "IN_TRANSIT"); assert.equal((await read(c)).shipments[0].status, "PENDING_TRACKING");
  assert.equal((await read(a)).status, "SHIPPED"); assert((await read(c)).shipments[0].lastTrackingCheckAt);
  ok("documented GET parameters; one file updates several shipments; booking/transit leave the order status alone");
  hits.length = 0;
  r = await manual(); assert(r.ran && r.newEvents === 0 && r.updated === 0 && r.processed === 0); assert.equal(await events(a), 1);
  assert(hits.length <= 2 && hits.every((h) => [ddmmyyyy(today), ddmmyyyy(d(-1))].includes(h.query.Event_Date)), JSON.stringify(hits.map((h) => h.query.Event_Date)));
  ok("closed days are not downloaded again; an unchanged file is not reprocessed; no duplicate events");
  hits.length = 0;
  assert.equal((await runTrackingCycle({ trigger: "SCHEDULED" }) as { reason?: string }).reason, "NOT_DUE"); assert.equal(hits.length, 0);
  ok("scheduled runs wait for the configured interval");

  files.set(ddmmyyyy(today), [{ number: A, code: "ITEM_DELIVERY", day: today, time: "000100" }, { number: B, code: "BEAT_DISPATCH", day: today, time: "000200" }, { number: C, code: "ITEM_NONDELIVER", day: today, time: "000300" }]);
  r = await manual(); assert(r.ran && r.updated === 3, JSON.stringify(r));
  const [oa, ob, oc] = [await read(a), await read(b), await read(c)];
  assert.equal(oa.status, "DELIVERED"); assert(oa.deliveredAt && oa.shipments[0].deliveredAt); assert.equal(oa.shipments[0].trackingEnabled, false); assert(!oa.shipments[0].nextTrackingCheckAt);
  assert.equal(ob.status, "OUT_FOR_DELIVERY"); assert.equal(oc.status, "DELIVERY_FAILED"); assert.equal(oc.statusHistory.at(-1)!.actorType, "SYSTEM");
  assert.equal(await m.Notification.countDocuments({ template: "ORDER_DELIVERED", "payload.orderId": new Types.ObjectId(a) }), 2); // one SMS, one email
  ok("delivery, out-for-delivery and failed attempt move the order and queue one notification per channel");
  assert.equal((await sh.queuedShipments()).length, 2);
  ok("delivered shipments leave regular tracking");

  files.set(ddmmyyyy(d(-2)), [{ number: B, code: "ITEM_BOOK", day: d(-2) }]);
  await runTrackingCycle({ trigger: "RECONCILE", reconcile: { from: d(-2), to: d(-2) } });
  assert.equal((await read(b)).shipments[0].status, "OUT_FOR_DELIVERY"); assert.equal((await read(b)).status, "OUT_FOR_DELIVERY"); assert.equal(await events(b), 3);
  ok("historical reconciliation adds an older event to the history without regressing the status");

  await m.Order.updateOne({ _id: c }, { $set: { status: "OUT_FOR_DELIVERY" }, $push: { statusHistory: { from: "DELIVERY_FAILED", to: "OUT_FOR_DELIVERY", actorType: "ADMIN", at: new Date() } } } as never);
  await manual(); assert.equal((await read(c)).status, "OUT_FOR_DELIVERY");
  ok("a staff status change is not undone by events already seen");
  files.get(ddmmyyyy(today))!.push({ number: C, code: "ITEM_RETURN", day: today, time: "000400" });
  await manual(); const rc = await read(c); assert.equal(rc.status, "RETURNED"); assert.equal(rc.shipments[0].trackingEnabled, false);
  ok("return stops tracking and marks the order returned");

  const late = serial(4); files.set(ddmmyyyy(d(-3)), [{ number: late, code: "ITEM_DISPATCH", day: d(-3) }]);
  await manual(); hits.length = 0;
  const l = await order(late, { shippedDaysAgo: 2 });
  r = await runTrackingCycle({ trigger: "SCHEDULED" }); assert(r.ran, JSON.stringify(r));
  assert.equal(await events(l), 1); assert(hits.some((h) => h.query.Event_Date === ddmmyyyy(d(-3))));
  assert.equal((await read(l)).shipments[0].trackingBackfillPending, false);
  hits.length = 0; await manual(); assert(!hits.some((h) => h.query.Event_Date === ddmmyyyy(d(-3))));
  ok("a consignment entered late gets its earlier days read once");

  console.log("Failure handling");
  forced = 503; hits.length = 0;
  r = await manual(); assert(r.ran && r.status === "FAILED"); assert.equal(hits.length, 1);
  assert.equal((await runTrackingCycle({ trigger: "SCHEDULED", now: later(0) }) as { reason?: string }).reason, "BACKOFF");
  const first = (await cfgMod.getState()).backoffUntil!.getTime() - Date.now();
  await manual(); await manual(); await manual(); await manual(); await manual();
  assert(await m.TrackingSyncFile.countDocuments({ status: "FAILED" }) >= 1); assert((await cfgMod.getState()).backoffUntil!.getTime() - Date.now() > first);
  assert.equal((await read(b)).status, "OUT_FOR_DELIVERY");
  hits.length = 0; await manual(); const failedDays = (await m.TrackingSyncFile.find({ status: "FAILED" }).lean()).map((f) => ddmmyyyy(f.eventDate as string));
  assert(!hits.some((h) => failedDays.includes(h.query.Event_Date)));
  ok("server errors back off exponentially and stop at the retry limit without touching orders");
  forced = 401; const before = await m.TrackingSyncFile.countDocuments({ attempts: { $gt: 0 } });
  await m.TrackingSyncFile.updateMany({}, { $set: { status: "RETRY", attempts: 0, final: false } });
  await manual(); assert.equal(await m.TrackingSyncFile.countDocuments({ attempts: { $gt: 0 } }), 0); void before;
  assert((await cfgMod.getState()).health!.accessRejected);
  ok("an IP-whitelisting refusal stops the run without using up retries");
  forced = null; await cfgMod.patchState({ backoffUntil: null });
  r = await runTrackingCycle({ trigger: "RETRY" }); assert(r.ran && r.status === "SUCCESS"); assert.equal((await cfgMod.getState()).health!.status, "HEALTHY");
  ok("recovers on the next successful run");

  console.log("Locking and recovery");
  const E = serial(5); const e = await order(E); files.set(ddmmyyyy(today), [{ number: E, code: "ITEM_DELIVERY", day: today, time: "000500" }]);
  const logsBefore = await m.TrackingSyncLog.countDocuments();
  const race = await Promise.all([manual(), manual(), manual()]);
  assert.equal(race.filter((x) => x.ran).length, 1, JSON.stringify(race)); assert.equal(await events(e), 1);
  assert.equal((await read(e)).statusHistory.filter((h) => h.to === "DELIVERED").length, 1); assert.equal(await m.TrackingSyncLog.countDocuments(), logsBefore + 1);
  ok("of three simultaneous workers exactly one runs");
  const held = await acquireLock(LOCK_NAME, 60_000); assert(held); assert.equal(await acquireLock(LOCK_NAME, 60_000), null);
  await m.JobLock.updateOne({ _id: LOCK_NAME }, { expiresAt: new Date(0) }); const taken = await acquireLock(LOCK_NAME, 60_000); assert(taken); assert.equal(await held.renew(), false); await held.release();
  assert.equal(await m.JobLock.countDocuments(), 1); await taken.release();
  await m.TrackingSyncLog.create({ carrier: "INDIA_POST", integrationMode: "BULK_XML", trigger: "SCHEDULED", syncStartedAt: new Date(0) });
  await order(serial(6)); await manual(); assert.equal(await m.TrackingSyncLog.countDocuments({ syncStatus: "RUNNING" }), 0); assert.equal(await m.TrackingSyncLog.countDocuments({ syncStatus: "ABORTED" }), 1);
  ok("a dead worker's lock expires, it cannot release the new owner's lock, and its log is closed");
  // Crash after events were stored but before the shipment was updated.
  const F = serial(7); const f = await order(F); const [ref] = await sh.queuedShipments({ "shipments.trackingNumber": F });
  await sh.saveEvents(ref, parseLatestEventXml(xml([{ number: F, code: "ITEM_DELIVERY", day: today, time: "000600" }])).events, "BULK_XML");
  files.get(ddmmyyyy(today))!.push({ number: F, code: "ITEM_DELIVERY", day: today, time: "000600" });
  await manual(); assert.equal((await read(f)).status, "DELIVERED"); assert.equal(await events(f), 1);
  ok("a half-finished run is completed by the next one");

  console.log("Individual article API");
  await m.Order.updateMany({}, { $set: { "shipments.$[].trackingEnabled": false } });
  const article = { enabled: true, mode: "ARTICLE_API", articleRequestTemplate: '{"ref":"{{trackingNumber}}"}', articleResponse: { eventsPath: "data.history", codeField: "c", dateField: "dt", timeField: "tm", descriptionField: "t" }, batchSize: 2, requestsPerMinute: 600 };
  await configure(article); process.env.INDIA_POST_AUTH_SECRET = "test-secret";
  const [G, H, I] = [serial(8), serial(9), serial(10)]; const g = await order(G), h = await order(H), i = await order(I);
  articles.set(G, { status: 200, events: [{ c: "ITEM_DISPATCH", dt: ddmmyyyy(today), tm: "000100", t: "Dispatched" }] });
  articles.set(H, { status: 200, events: [{ c: "BEAT_DISPATCH", dt: ddmmyyyy(today), tm: "000100", t: "Beat" }] });
  hits.length = 0; const sleeps: number[] = [];
  r = await runTrackingCycle({ trigger: "SCHEDULED", sleep: async (ms) => { sleeps.push(ms); } });
  assert(r.ran && r.processed === 2, JSON.stringify(r)); assert.equal(hits.length, 2); assert.deepEqual(sleeps, [100]); assert(hits.every((x) => /^\{"ref":"EE\d{9}IN"\}$/.test(x.body) && !x.auth));
  const gs = (await read(g)).shipments[0], hs = (await read(h)).shipments[0];
  assert(gs.nextTrackingCheckAt!.getTime() > hs.nextTrackingCheckAt!.getTime()); assert.equal((await read(h)).status, "OUT_FOR_DELIVERY");
  ok("one request per article, batched and rate limited; out-for-delivery is checked sooner");
  hits.length = 0; await runTrackingCycle({ trigger: "SCHEDULED", sleep: async () => {} }); assert.equal(hits.length, 1);
  assert.equal((await runTrackingCycle({ trigger: "SCHEDULED" }) as { reason?: string }).reason, "IDLE");
  ok("only shipments that are due are requested");
  articles.set(I, { status: 500 });
  for (let k = 1; k <= 3; k++) {
    await cfgMod.patchState({ backoffUntil: null });
    await m.Order.updateOne({ _id: i, "shipments.0.trackingFailed": { $ne: true } }, { $set: { "shipments.0.nextTrackingCheckAt": new Date(0) } });
    await runTrackingCycle({ trigger: "SCHEDULED", sleep: async () => {} });
    assert.equal((await read(i)).shipments[0].retryCount, k);
  }
  let is = (await read(i)).shipments[0]; assert(is.trackingFailed && is.trackingError && !is.nextTrackingCheckAt);
  assert.equal((await dashboard({ order: "", number: "", status: "", failed: true, page: 1, perPage: 10 })).total, 1);
  ok("a failing article is retried up to the limit, then parked and shown as failed");
  articles.set(I, { status: 200, events: [{ c: "ITEM_RECEIVE", dt: ddmmyyyy(today), tm: "000100", t: "Received" }] });
  r = await runTrackingCycle({ trigger: "RETRY", shipmentId: String(is._id), sleep: async () => {} }); assert(r.ran && r.processed === 1);
  is = (await read(i)).shipments[0]; assert(!is.trackingFailed && !is.trackingError && is.status === "IN_TRANSIT" && is.retryCount === 0);
  ok("manual retry restores a parked shipment");
  articles.set(G, { status: 429 }); await m.Order.updateOne({ _id: g }, { $set: { "shipments.0.nextTrackingCheckAt": new Date(0) } }); await cfgMod.patchState({ backoffUntil: null });
  await runTrackingCycle({ trigger: "SCHEDULED", sleep: async () => {} });
  assert((await cfgMod.getState()).backoffUntil!.getTime() - Date.now() > 800_000); assert.equal((await read(g)).shipments[0].retryCount, 0);
  ok("a rate-limit answer pauses all requests for Retry-After");
  await configure({ ...article, authType: "BEARER" }); articles.set(G, { status: 200, events: [] }); hits.length = 0;
  await manual(); assert(hits.length && hits.every((x) => x.auth === "Bearer test-secret"));
  assert(!JSON.stringify([await m.TrackingSyncLog.find().lean(), await m.Setting.find().lean()]).includes("test-secret"));
  ok("credentials are sent only from the environment and never stored or logged");

  console.log("Customer view, dashboard, existing orders");
  const view = await getOrderTrusted((await read(e)).orderNumber);
  assert(view!.shipment!.tracking!.delivered && view!.shipment!.tracking!.events.length === 1 && view!.shipment!.carrier === "India Post");
  assert(!/trackingError|retryCount|SECRET RECEIVER|rawEventData|India Post E/.test(JSON.stringify(view)));
  assert.equal((await getOrderTrusted((await read(other)).orderNumber))!.shipment!.tracking, null);
  ok("customer sees status, timeline and delivery confirmation without internal data; other couriers unchanged");
  const dash = await dashboard({ order: "", number: E.toLowerCase(), status: "DELIVERED", failed: false, page: 1, perPage: 10 });
  assert.equal(dash.total, 1); assert(dash.counts.delivered >= 3 && dash.counts.returned === 1);
  assert.equal((await dashboard({ order: ".*(", number: "", status: "", failed: false, page: 1, perPage: 10 })).total, 0);
  ok("dashboard counts and filters");
  const old = await order(` ${serial(11).toLowerCase()} `, { carrier: "Speed Post", enrol: false });
  const junk = await order("RECEIPT-1", { carrier: "India Post", enrol: false });
  const en = await sh.enrolExistingShipments(await cfgMod.getConfig()); assert.equal(en.enrolled, 1); assert.equal(en.skipped.length, 1);
  assert.equal((await read(old)).shipments[0].trackingNumber, serial(11)); assert(!(await read(junk)).shipments[0].trackingEnabled);
  assert.equal((await sh.enrolExistingShipments(await cfgMod.getConfig())).enrolled, 0);
  ok("orders shipped by hand can be enrolled once; unreadable numbers are skipped");
  await sh.syncEnrolment(new Types.ObjectId(old), { carrier: "INDIA_POST", trackingNumber: "OLD" }, await cfgMod.getConfig());
  await m.Order.updateOne({ _id: old }, { $set: { status: "DELIVERED" } }); await sh.retireShipments(await cfgMod.getConfig());
  assert.equal((await read(old)).shipments[0].trackingEnabled, false); assert.equal((await read(old)).shipments[0].status, "DELIVERED");
  ok("closing an order by hand stops its tracking");
  const two = await order(undefined, { shipments: [serial(12), serial(13)].map((x) => ({ carrier: "INDIA_POST", trackingNumber: x, shippedAt: new Date(), ...sh.enrolmentFields({ initialDelayMinutes: 0 }) })) });
  const cfg = await cfgMod.getConfig();
  for (const [k, ref2] of (await sh.queuedShipments({ "shipments.trackingNumber": { $in: [serial(12), serial(13)] } })).entries()) {
    await sh.saveEvents(ref2, parseLatestEventXml(xml([{ number: ref2.shipment.trackingNumber!, code: "ITEM_DELIVERY", day: today, time: "000700" }])).events, "BULK_XML");
    await sh.applyEvents(ref2, cfg);
    assert.equal((await read(two)).status, k === 0 ? "SHIPPED" : "DELIVERED");
  }
  ok("an order with two parcels is delivered only when both are");

  await clear();
  console.log(`\n${n} checks passed (local stand-in; live India Post not tested)`);
}

main().then(async () => { server.close(); (await import("mongoose")).default.disconnect(); }, async (e) => { console.error(e); server.close(); await (await import("mongoose")).default.disconnect(); process.exit(1); });
