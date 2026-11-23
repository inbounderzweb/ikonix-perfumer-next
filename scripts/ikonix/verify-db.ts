// Verifies the imported catalogue in MongoDB against the extraction export, and proves the
// database rejects invalid writes. Read-only apart from writes that are expected to be rejected.
// Usage: npx tsx scripts/ikonix/verify-db.ts      (exit code 1 on any failure)
import fs from "node:fs";
import path from "node:path";
import { Types } from "mongoose";
import { connect, disconnect } from "./_env";
import { Brand, Category, Inventory, Product, ProductCollection } from "../../src/server/models";

const ROOT = process.cwd();
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures.push(msg); };

async function expectRejected(label: string, fn: () => Promise<unknown>) {
  try {
    const r = (await fn()) as { matchedCount?: number; modifiedCount?: number } | undefined;
    check(false, `${label}: write was ACCEPTED (${JSON.stringify(r)})`);
  } catch (e) {
    const err = e as { code?: number; name?: string };
    check(err.code === 121 || err.name === "ValidationError", `${label}: rejected (${err.name}${err.code ? ` code ${err.code}` : ""})`);
  }
}

async function main() {
  const db = await connect();
  const exp = JSON.parse(fs.readFileSync(path.join(ROOT, "public/ikonix/export/all-products.json"), "utf8")).products as {
    id: string; slug: string; variants: { id: string; regularPrice: number; salePrice: number }[];
  }[];
  const products = await Product.find().lean();
  const byLegacy = new Map(products.map((p) => [p.legacyId!, p]));

  // ── Counts ──
  const variants = products.flatMap((p) => p.variants.map((v) => ({ p, v })));
  const images = products.flatMap((p) => p.images.map((i) => ({ p, i })));
  check(products.length === exp.length, `products: ${products.length} in DB vs ${exp.length} extracted`);
  check(exp.every((e) => byLegacy.has(e.id)), "every extracted product id is in the DB");
  check(variants.length === exp.reduce((a, e) => a + e.variants.length, 0), `variants: ${variants.length}`);
  check(images.length === 2845, `product images: ${images.length} (expected 2845)`);

  // ── Prices preserved exactly (rupees → paise) ──
  let priceMismatch = 0;
  for (const e of exp) for (const ev of e.variants) {
    const v = byLegacy.get(e.id)?.variants.find((x) => x.legacyId === ev.id);
    if (!v || v.regularPrice !== Math.round(ev.regularPrice * 100) || v.salePrice !== Math.round(ev.salePrice * 100)) priceMismatch++;
  }
  check(priceMismatch === 0, `variant prices match extraction exactly (${priceMismatch} mismatches)`);

  // ── Slugs / SKUs unique ──
  check(new Set(products.map((p) => p.slug)).size === products.length, "slugs unique");
  check(new Set(variants.map(({ v }) => v.sku)).size === variants.length, "SKUs unique");

  // ── Images exist and belong to their product/variant ──
  // Images are hosted on Cloudinary (migrate-images.ts); a local /ikonix/ path is still accepted for un-migrated or new local images.
  const cloud = "https://res.cloudinary.com/"; // any account: the cloud name in .env can change
  const missing = images.filter(({ i }) => (i.url.startsWith("/ikonix/") ? !fs.existsSync(path.join(ROOT, "public", i.url)) : !i.url.startsWith(cloud)));
  check(missing.length === 0, `every image is on Cloudinary or an existing local file (${missing.length} bad)`);
  check(images.every(({ i }) => !!i.storageKey && i.width > 0 && i.height > 0), "every image has a storage key and dimensions");
  check(products.every((p) => !p.primaryImageId || p.images.some((i) => String(i._id) === String(p.primaryImageId))), "primaryImageId points to an image of the same product");
  check(images.every(({ p, i }) => !i.variantId || p.variants.some((v) => String(v._id) === String(i.variantId))), "variant images point to a variant of the same product");

  // ── Status rules ──
  const active = products.filter((p) => p.status === "ACTIVE");
  const draft = products.filter((p) => p.status === "DRAFT");
  check(active.every((p) => p.reviewIssues.length === 0 && p.variants.every((v) => v.isActive && v.salePrice <= v.regularPrice)), `${active.length} ACTIVE products: no issues, all variants sellable`);
  check(draft.every((p) => p.reviewIssues.length > 0), `${draft.length} DRAFT products each list their review issues`);
  check(active.every((p) => p.primaryCategoryId && p.categoryIds.length > 0), "every ACTIVE product has a category");
  check(active.every((p) => p.minSalePrice != null && p.minSalePrice === Math.min(...p.variants.map((v) => v.salePrice))), "minSalePrice cache is correct on ACTIVE products");

  // ── Inventory ↔ variants ──
  const inv = await Inventory.find().lean();
  const variantIds = new Map(variants.map(({ p, v }) => [String(v._id), String(p._id)]));
  check(inv.length === variants.length, `inventory rows: ${inv.length} for ${variants.length} variants`);
  check(inv.every((r) => variantIds.get(String(r.variantId)) === String(r.productId)), "every inventory row matches an existing variant of the right product");

  // ── Taxonomy ──
  const cats = await Category.countDocuments();
  const best = await ProductCollection.findOne({ key: "best-sellers" }).lean();
  const brands = await Brand.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$kind", n: { $sum: 1 } } }]);
  check(cats === 3, `categories: ${cats} (mens, women's, unisex)`);
  check(best?.productIds.length === 48, `best-sellers collection: ${best?.productIds.length} products`);
  console.log(`info  brands: ${JSON.stringify(Object.fromEntries(brands.map((b) => [b._id, b.n])))}`);

  // ── Database rejects invalid writes (MongoDB validators, not just Mongoose) ──
  const someInv = inv[0];
  await expectRejected("inventory onHand -1", () => db.collection("inventory").updateOne({ _id: someInv._id }, { $set: { onHand: -1 } }));
  await expectRejected("inventory reserved > onHand", () => db.collection("inventory").updateOne({ _id: someInv._id }, { $set: { onHand: 0, reserved: 1 } }));
  const bad = products.find((p) => p.variants.some((v) => !v.isActive && v.salePrice > v.regularPrice));
  if (bad) {
    const v = bad.variants.find((x) => !x.isActive && x.salePrice > x.regularPrice)!;
    await expectRejected(`activate variant ${v.sku} with sale > MRP (raw update)`, () =>
      db.collection("products").updateOne({ _id: bad._id, "variants._id": v._id }, { $set: { "variants.$.isActive": true } }));
    await expectRejected(`activate variant ${v.sku} with sale > MRP (Mongoose save)`, async () => {
      const doc = await Product.findById(bad._id);
      doc!.variants.id(v._id)!.isActive = true;
      await doc!.save();
    });
  }
  await expectRejected("order with inconsistent grandTotal", () => db.collection("orders").insertOne({
    _id: new Types.ObjectId(), orderNumber: "TEST-INVALID", subtotal: 1000, discountTotal: 0, shippingTotal: 0, packingTotal: 0, taxTotal: 0, grandTotal: 999,
  }));
  await expectRejected("review rating 6", () => db.collection("product_reviews").insertOne({ productId: products[0]._id, userId: new Types.ObjectId(), rating: 6 }));

  // Atomic reservation guard: reserving more than available matches nothing.
  const r = await Inventory.updateOne(
    { _id: someInv._id, $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, 1] } },
    { $inc: { reserved: 1 } },
  );
  check(r.matchedCount === 0, "reserve 1 unit with 0 available matches nothing (no oversell)");
  const after = await Inventory.findById(someInv._id).lean();
  check(after!.onHand === someInv.onHand && after!.reserved === someInv.reserved, "inventory unchanged after rejected writes");
  check((await db.collection("orders").countDocuments({ orderNumber: "TEST-INVALID" })) === 0, "no test order was stored");

  console.log(failures.length ? `\n${failures.length} FAILURE(S)` : "\nALL CHECKS PASSED");
  process.exitCode = failures.length ? 1 : 0;
}

main().then(disconnect, async (e) => { console.error(e); await disconnect(); process.exit(1); });
