// Legacy (PHP/MySQL) -> MongoDB migration: customers, addresses, orders, payments.
//
//   DRY RUN (default, writes NOTHING; only reads MongoDB to match existing records):
//     npm run legacy:dry-run
//     npm run legacy:dry-run -- --dump=/path/to/ikonix.sql
//
//   EXECUTE (writes; every gate below is mandatory):
//     LEGACY_MIGRATION_APPROVED=yes npm run legacy:execute -- --confirm-db=<db name> --approved-fingerprint=<from the dry-run report> --backup-verified
//
//   ROLLBACK (removes only documents carrying legacy.source = this migration):
//     LEGACY_MIGRATION_APPROVED=yes npm run legacy:rollback -- --confirm-db=<db name> --backup-verified
//
// Nothing here sends SMS/email, calls Razorpay, or touches notification code: documents are written straight to the
// collections. Background jobs only act on PENDING orders, and imported orders are never PENDING.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mongoose, { Types } from "mongoose";
import { connect, disconnect } from "../ikonix/_env";
import { Address, Order, Payment, Product, TestLogin, User } from "../../src/server/models";
import { parseDump } from "./sql-parse";
import { SOURCE, buildPlan, type Ctx } from "./plan";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const flag = (n: string) => process.argv.includes(`--${n}`);
const MODE = flag("execute") ? "execute" : flag("rollback") && !flag("preview") ? "rollback" : flag("rollback") ? "rollback-preview" : "dry-run";
const DUMP = arg("dump") ?? path.join(process.env.HOME ?? "", "Downloads/ikonix.sql");
const OUT = path.join(process.cwd(), "scripts/legacy-migration/reports");
const BATCH = 50;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

type Lean<T> = T & { _id: Types.ObjectId };
const sid = (x: unknown) => String(x);

/** Actual Razorpay records. Accepts the JSON written by verify-payments.ts, or a dashboard CSV export (columns: id, amount in rupees, status). */
function loadRazorpay(file?: string): Ctx["razorpay"] {
  if (!file) return null;
  const txt = fs.readFileSync(file, "utf8"); const m = new Map<string, { amountPaise: number; status: string }>();
  if (file.endsWith(".json")) { for (const r of JSON.parse(txt) as { id: string; amountPaise: number; status: string }[]) m.set(r.id, { amountPaise: r.amountPaise, status: String(r.status).toLowerCase() }); return m; }
  const [head, ...lines] = txt.split(/\r?\n/).filter(Boolean); const cols = head.split(",").map((c) => c.replace(/"/g, "").trim().toLowerCase());
  const ix = (re: RegExp) => cols.findIndex((c) => re.test(c)); const iId = ix(/^(payment )?id$/), iAmt = ix(/amount/), iSt = ix(/status/);
  if (iId < 0 || iAmt < 0 || iSt < 0) throw new Error("Razorpay CSV needs id, amount and status columns");
  for (const l of lines) { const c = l.split(",").map((x) => x.replace(/"/g, "").trim()); if (c[iId]) m.set(c[iId], { amountPaise: Math.round(Number(c[iAmt]) * 100), status: c[iSt].toLowerCase() }); }
  return m;
}

async function loadContext(): Promise<Ctx> {
  const [users, addrs, tests, products, lo, lp] = await Promise.all([
    User.find({}, "mobile email roleKeys").lean() as unknown as Promise<Lean<{ mobile?: string; email?: string; roleKeys?: string[] }>[]>,
    Address.find({ deletedAt: null }, "userId line1 postalCode").lean() as unknown as Promise<Lean<{ userId: Types.ObjectId; line1: string; postalCode: string }>[]>,
    TestLogin.find({}, "mobile").lean() as unknown as Promise<{ mobile: string }[]>,
    Product.find({}, "slug name legacyId variants._id variants.legacyId variants.sizeValue variants.sizeUnit variants.label variants.sku images.url images.sourceUrl images.sortOrder").lean() as unknown as Promise<Lean<{ slug: string; name: string; legacyId?: string; variants: { _id: Types.ObjectId; legacyId?: string; sizeValue?: number; sizeUnit?: string; label: string; sku: string }[]; images: { url: string; sourceUrl?: string; sortOrder?: number }[] }>[]>,
    Order.find({ "legacy.source": SOURCE }, "legacy.orderId").lean() as unknown as Promise<{ legacy: { orderId: number } }[]>,
    Payment.find({ "legacy.source": SOURCE }, "legacy.paymentId").lean() as unknown as Promise<{ legacy: { paymentId: number } }[]>,
  ]);
  return {
    existingUsers: users.map((u) => ({ _id: sid(u._id), mobile: u.mobile, email: u.email, isStaff: (u.roleKeys ?? []).length > 0 })),
    existingAddresses: addrs.map((a) => ({ userId: sid(a.userId), line1: a.line1, postalCode: a.postalCode })),
    testMobiles: tests.map((t) => t.mobile),
    products: products.map((p) => ({ _id: sid(p._id), slug: p.slug, name: p.name, legacyId: p.legacyId, variants: p.variants.map((v) => ({ ...v, _id: sid(v._id) })), images: p.images })),
    existingLegacyOrderIds: lo.map((o) => o.legacy.orderId), existingLegacyPaymentIds: lp.map((p) => p.legacy.paymentId),
    migratedAt: new Date(), razorpay: loadRazorpay(arg("razorpay-data")), releaseReview: flag("release-review"),
  };
}

/** In-memory schema validation of every planned document (Mongoose validators + the order total/line-total hooks). Writes nothing. */
async function validateAll(p: ReturnType<typeof buildPlan>) {
  const stats = { checked: 0, failed: 0 };
  const check = async (table: string, id: number, doc: mongoose.Document) => {
    stats.checked++;
    try { await doc.validate(); } catch (e) { stats.failed++; p.errors.push({ table, id, reason: `schema validation: ${(e as Error).message.slice(0, 220)}` }); }
  };
  const fakeId = () => new Types.ObjectId();
  for (const c of p.customers) if (!c.matchedExistingId) await check("users", c.legacyUid, new User(c.doc));
  for (const a of p.addresses) await check("address", a.legacyAid, new Address({ ...a.doc, userId: fakeId() }));
  for (const o of p.orders) await check("orders", o.legacyOid, new Order({ ...o.doc, userId: o.customerKey ? fakeId() : null }));
  for (const x of p.payments) await check("paylog", x.legacyPayId, new Payment({ ...x.doc, orderId: fakeId() }));
  return stats;
}

/** Read-only: would anything in the plan collide with a document that is NOT part of this migration? */
async function overwriteCheck(p: ReturnType<typeof buildPlan>) {
  const nums = p.orders.map((o) => o.doc.orderNumber as string); const keys = p.orders.map((o) => o.doc.idempotencyKey as string);
  const payIds = p.payments.map((x) => x.doc.providerPaymentId as string); const provOrd = p.payments.map((x) => x.doc.providerOrderId as string);
  const notOurs = { "legacy.source": { $ne: SOURCE } };
  const [o, pay] = await Promise.all([
    Order.countDocuments({ $or: [{ orderNumber: { $in: nums } }, { idempotencyKey: { $in: keys } }], ...notOurs }),
    Payment.countDocuments({ $or: [{ providerPaymentId: { $in: payIds } }, { providerOrderId: { $in: provOrd } }], ...notOurs }),
  ]);
  const mobiles = p.customers.filter((c) => !c.matchedExistingId).map((c) => c.mobile);
  const u = await User.countDocuments({ mobile: { $in: mobiles } });
  return { ordersCollidingWithExisting: o, paymentsCollidingWithExisting: pay, newCustomersWhoseMobileAlreadyExists: u, existingCustomersModified: 0, existingAddressesModified: 0, existingOrdersModified: 0, existingPaymentsModified: 0 };
}

/** Read-only: what a rollback would do right now. */
async function rollbackPreview() {
  const f = { "legacy.source": SOURCE };
  const users = (await User.find(f, "_id lastLoginAt").lean()) as unknown as Lean<{ lastLoginAt?: Date }>[];
  let keep = 0; for (const u of users) if (u.lastLoginAt || (await Order.exists({ userId: u._id, "legacy.source": { $ne: SOURCE } }))) keep++;
  return { wouldDelete: { payments: await Payment.countDocuments(f), orders: await Order.countDocuments(f), addresses: await Address.countDocuments(f), customers: users.length - keep }, customersKeptBecauseLive: keep, notTouched: "every document without legacy.source" };
}

const fingerprint = (p: ReturnType<typeof buildPlan>) =>
  crypto.createHash("sha256").update(JSON.stringify({ c: p.customers.map((c) => [c.legacyUid, c.mobile]), a: p.addresses.map((a) => a.legacyAid), o: p.orders.map((o) => [o.legacyOid, o.grandTotal, o.customerKey, (o.doc.items as { productId?: string; variantId?: string; quantity: number; freeQuantity: number }[]).map((i) => [i.productId, i.variantId, i.quantity, i.freeQuantity])]), p: p.payments.map((x) => [x.legacyPayId, x.doc.amount, (x.doc.legacy as { verification: string }).verification]) })).digest("hex").slice(0, 12);

// ── Report ───────────────────────────────────────────────────────────────────────────────────────────────────────
function writeReport(p: ReturnType<typeof buildPlan>, fp: string, dbName: string) {
  fs.mkdirSync(OUT, { recursive: true });
  const r = p.report; const inr = (x: number) => `₹${(x / 100).toLocaleString("en-IN")}`;
  const kv = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `| ${k} | ${typeof v === "object" ? JSON.stringify(v) : v} |`).join("\n");
  const sec = (title: string, o: Record<string, unknown>) => `### ${title}\n| Metric | Count |\n|---|---|\n${kv(o)}\n`;
  const group = (xs: { reason: string }[]) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x.reason.replace(/\d+/g, "N")] = (m[x.reason.replace(/\d+/g, "N")] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`).join("\n");
  const md = `# Legacy migration: ${MODE.toUpperCase()} report
Target database: **${dbName}** · source: \`${path.basename(DUMP)}\` · generated ${new Date().toISOString()}
Plan fingerprint (required to execute): **${fp}**

> No data was written. This report is the output of a read-only dry run.

${sec("Customers", r.customers)}
${sec("Addresses", r.addresses)}
${sec("Orders", { ...r.orders })}
${sec("Payments", r.payments)}
${sec("Products", r.products)}
${sec("Guest orders", r.guests)}
${sec("Discounts / free items", r.discounts)}
${sec("Overwrite safety (read-only check)", (r as unknown as { overwriteSafety: Record<string, unknown> }).overwriteSafety)}
${sec("Rollback preview (current state)", (r as unknown as { rollbackPreview: Record<string, unknown> }).rollbackPreview)}
### Pending owner review (not imported): ${p.pendingReview.length} orders
${p.pendingReview.map((x) => `order ${x.id}`).join(", ") || "none"}

${sec("Schema validation (in memory)", (r as unknown as { validation: Record<string, unknown> }).validation)}
${sec("Order totals", { ...r.totals, grandTotalSum: inr(r.totals.grandTotalSumPaise) })}
### Excluded orders by reason
| Reason | Orders |\n|---|---|\n${group(p.excludedOrders)}

### Skipped records by reason
| Reason | Records |\n|---|---|\n${group(p.skipped)}

### Warnings by kind (${p.warnings.length})
| Warning | Count |\n|---|---|\n${group(p.warnings)}

### Errors (${p.errors.length})
${p.errors.length ? "| Table | Id | Reason |\n|---|---|---|\n" + p.errors.map((e) => `| ${e.table} | ${e.id} | ${e.reason} |`).join("\n") : "None."}

### Masked samples
\`\`\`json
${JSON.stringify(p.sample, null, 2)}
\`\`\`
`;
  fs.writeFileSync(path.join(OUT, `${MODE}-${stamp}.md`), md);
  fs.writeFileSync(path.join(OUT, `${MODE}-${stamp}.json`), JSON.stringify({ fingerprint: fp, db: dbName, report: r, skipped: p.skipped, warnings: p.warnings, errors: p.errors, excludedOrders: p.excludedOrders }, null, 1));
  return path.join(OUT, `${MODE}-${stamp}.md`);
}

// ── Execute (guarded) ────────────────────────────────────────────────────────────────────────────────────────────
function requireGates(dbName: string, fp?: string) {
  const problems: string[] = [];
  if (process.env.LEGACY_MIGRATION_APPROVED !== "yes") problems.push("LEGACY_MIGRATION_APPROVED=yes is not set");
  if (arg("confirm-db") !== dbName) problems.push(`--confirm-db must equal the connected database name ("${dbName}")`);
  if (!flag("backup-verified")) problems.push("--backup-verified missing: take an Atlas backup/export and confirm you can open it");
  if (fp && arg("approved-fingerprint") !== fp) problems.push(`--approved-fingerprint must equal the reviewed dry-run fingerprint (${fp})`);
  if (problems.length) { console.error("Refusing to write:\n - " + problems.join("\n - ")); process.exit(2); }
}

async function chunked<T>(xs: T[], fn: (batch: T[]) => Promise<void>) { for (let i = 0; i < xs.length; i += BATCH) await fn(xs.slice(i, i + BATCH)); }

async function execute(p: ReturnType<typeof buildPlan>) {
  const failed: { table: string; id: number | string; error: string }[] = [];
  const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
  // Additive, idempotent index creation (same indexes the models declare); never drops anything.
  await Promise.all([User.createIndexes(), Address.createIndexes(), Order.createIndexes(), Payment.createIndexes()]);

  // 1. Customers: only NEW ones are inserted. Customers that already exist (matched by mobile) are never modified.
  const fresh = p.customers.filter((c) => !c.matchedExistingId);
  await chunked(fresh, async (b) => {
    const r = await User.bulkWrite(b.map((c) => ({ updateOne: { filter: { "legacy.source": SOURCE, "legacy.customerId": c.legacyUid }, update: { $setOnInsert: c.doc }, upsert: true } })) as never, { ordered: false }).catch((e) => e);
    collect(r, b.map((c) => c.legacyUid), "users", failed);
  });
  const uidMap = new Map<number, string>(p.customers.filter((c) => c.matchedExistingId).map((c) => [c.legacyUid, c.matchedExistingId!]));
  for (const u of (await User.find({ "legacy.source": SOURCE }, "legacy.customerId").lean()) as unknown as Lean<{ legacy: { customerId: number } }>[]) uidMap.set(u.legacy.customerId, sid(u._id));
  log(`customers: ${fresh.length} new planned, ${uidMap.size} resolvable`);

  // 2. Addresses (never touches existing ones)
  const addrs = p.addresses.filter((a) => uidMap.has(a.legacyUid));
  await chunked(addrs, async (b) => {
    const r = await Address.bulkWrite(b.map((a) => ({ updateOne: { filter: { "legacy.source": SOURCE, "legacy.addressId": a.legacyAid }, update: { $setOnInsert: { ...a.doc, userId: new Types.ObjectId(uidMap.get(a.legacyUid)) } }, upsert: true } })) as never, { ordered: false }).catch((e) => e);
    collect(r, b.map((a) => a.legacyAid), "address", failed);
  });
  for (const a of addrs.filter((x) => x.isDefault)) {
    const c = p.customers.find((x) => x.legacyUid === a.legacyUid)!; if (c.matchedExistingId) continue;
    const doc = (await Address.findOne({ "legacy.source": SOURCE, "legacy.addressId": a.legacyAid }, "_id").lean()) as unknown as Lean<object> | null;
    if (doc) await User.updateOne({ _id: uidMap.get(a.legacyUid), defaultAddressId: null }, { $set: { defaultAddressId: doc._id } });
  }
  log(`addresses: ${addrs.length} processed`);

  // 3. Orders: legacy-owned documents, safe to refresh from a newer dump ($set). Linked to a customer only when planned as reliable.
  await chunked(p.orders, async (b) => {
    const r = await Order.bulkWrite(b.map((o) => {
      const key = o.customerKey; const userId = key ? new Types.ObjectId("existingId" in key && key.existingId ? key.existingId : uidMap.get(key.legacyUid!)) : null;
      return { updateOne: { filter: { "legacy.source": SOURCE, "legacy.orderId": o.legacyOid }, update: { $set: { ...o.doc, userId } }, upsert: true } };
    }) as never, { ordered: false }).catch((e) => e);
    collect(r, b.map((o) => o.legacyOid), "orders", failed);
  });
  log(`orders: ${p.orders.length} processed`);

  // 4. Payments: records only. No capture, refund or webhook is invoked.
  const orderIds = new Map((await Order.find({ "legacy.source": SOURCE }, "legacy.orderId").lean() as unknown as Lean<{ legacy: { orderId: number } }>[]).map((o) => [o.legacy.orderId, o._id]));
  await chunked(p.payments.filter((x) => orderIds.has(x.legacyOid)), async (b) => {
    const r = await Payment.bulkWrite(b.map((x) => ({ updateOne: { filter: { "legacy.source": SOURCE, "legacy.paymentId": x.legacyPayId }, update: { $setOnInsert: { ...x.doc, orderId: orderIds.get(x.legacyOid) } }, upsert: true } })) as never, { ordered: false }).catch((e) => e);
    collect(r, b.map((x) => x.legacyPayId), "paylog", failed);
  });
  log(`payments: ${p.payments.length} processed`);

  // 5. Verify against the source
  const [nu, na, no, np] = await Promise.all([User.countDocuments({ "legacy.source": SOURCE }), Address.countDocuments({ "legacy.source": SOURCE }), Order.countDocuments({ "legacy.source": SOURCE }), Payment.countDocuments({ "legacy.source": SOURCE })]);
  const verify = { users: [nu, fresh.length], addresses: [na, addrs.length], orders: [no, p.orders.length], payments: [np, p.payments.length] };
  log(`verify (in DB vs planned): ${JSON.stringify(verify)}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `execute-failed-${stamp}.json`), JSON.stringify({ failed, verify }, null, 1));
  if (failed.length) { console.error(`${failed.length} record(s) failed: see execute-failed-${stamp}.json`); process.exitCode = 1; }
}

function collect(res: unknown, ids: (number | string)[], table: string, failed: { table: string; id: number | string; error: string }[]) {
  type BulkErr = { writeErrors?: { index?: number; err?: { index?: number; errmsg?: string } }[]; name?: string; message?: string };
  const e = res as BulkErr;
  if (e && (e.name === "MongoBulkWriteError" || e.writeErrors || res instanceof Error)) {
    for (const w of e.writeErrors ?? []) { const i = w.err?.index ?? w.index ?? 0; failed.push({ table, id: ids[i], error: (w.err?.errmsg ?? "write error").slice(0, 200) }); }
    if (!e.writeErrors?.length) for (const id of ids) failed.push({ table, id, error: (e.message ?? "bulk write failed").slice(0, 200) });
  }
}

async function rollback() {
  const f = { "legacy.source": SOURCE };
  const pay = await Payment.deleteMany(f); const ord = await Order.deleteMany(f); const adr = await Address.deleteMany(f);
  // A legacy customer who has since logged in or placed a new order is a live account: keep it, only drop the legacy marker.
  const legacyUsers = (await User.find(f, "_id lastLoginAt").lean()) as unknown as Lean<{ lastLoginAt?: Date }>[];
  let removed = 0; let kept = 0;
  for (const u of legacyUsers) {
    const hasOrders = await Order.exists({ userId: u._id });
    if (u.lastLoginAt || hasOrders) { await User.updateOne({ _id: u._id }, { $unset: { legacy: 1 } }); kept++; } else { await User.deleteOne({ _id: u._id }); removed++; }
  }
  console.log(`rollback: payments ${pay.deletedCount}, orders ${ord.deletedCount}, addresses ${adr.deletedCount}, customers removed ${removed}, customers kept (live) ${kept}`);
}

async function main() {
  if (!fs.existsSync(DUMP)) throw new Error(`Dump not found: ${DUMP}`);
  const db = await connect();
  const dbName = db.databaseName;
  console.log(`mode: ${MODE.toUpperCase()}${MODE === "dry-run" ? " (no writes)" : ""}`);
  if (MODE === "rollback-preview") { console.log(JSON.stringify(await rollbackPreview(), null, 1)); return; }
  if (MODE === "rollback") { requireGates(dbName); return rollback(); }
  const tables = parseDump(DUMP);
  const ctx = await loadContext();
  const plan = buildPlan(tables, ctx);
  const safety = await overwriteCheck(plan);
  (plan.report as Record<string, unknown>).overwriteSafety = safety;
  if (safety.ordersCollidingWithExisting || safety.paymentsCollidingWithExisting || safety.newCustomersWhoseMobileAlreadyExists) plan.errors.push({ table: "safety", id: "collision", reason: JSON.stringify(safety) });
  const rbk = await rollbackPreview();
  (plan.report as Record<string, unknown>).rollbackPreview = rbk;
  const validation = await validateAll(plan);
  console.log(`schema validation: ${validation.checked} documents checked, ${validation.failed} failed`);
  (plan.report as Record<string, unknown>).validation = validation;
  const fp = fingerprint(plan);
  const file = writeReport(plan, fp, dbName);
  console.log(`report: ${file}\nfingerprint: ${fp}`);
  console.log(JSON.stringify({ customers: plan.report.customers, orders: { candidates: plan.report.orders.importCandidates, excluded: plan.report.orders.excluded }, payments: plan.report.payments, addresses: plan.report.addresses.valid }, null, 1));
  if (MODE === "execute") { requireGates(dbName, fp); await execute(plan); }
}

main().then(() => disconnect(), async (e) => { console.error(e instanceof Error ? e.message : e); await mongoose.disconnect(); process.exit(1); });
