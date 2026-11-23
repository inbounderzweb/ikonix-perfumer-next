// Copies the CATALOGUE (products, images, brands, categories, collections, stock rows, shipping methods) from one MongoDB
// to another, e.g. local -> Atlas. Customers, orders, sessions, audit logs and OTPs are never copied.
//
//   SOURCE_MONGODB_URI   where to read from (default: the local replica set)
//   MONGODB_URI          where to write to (from .env, the same database the app uses)
//
// Run `npm run ikonix:setup-db` against the target first (validators and indexes), then:
//   npx tsx scripts/ikonix/copy-catalogue.ts --dry-run     (counts only)
//   npx tsx scripts/ikonix/copy-catalogue.ts
// Safe to re-run: documents are matched by _id. Stock (`inventory`) is insert-only, so real stock entered on the target is never overwritten.
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";

loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const SOURCE = process.env.SOURCE_MONGODB_URI || "mongodb://127.0.0.1:27017/ikonix?replicaSet=rs0";
const TARGET = process.env.MONGODB_URI;
const DRY = process.argv.includes("--dry-run");
const CATALOGUE = ["media_assets", "brands", "categories", "collections", "products", "shipping_methods", "inventory"] as const;
const INSERT_ONLY = new Set<string>(["inventory"]);
const redact = (u: string) => u.replace(/\/\/[^@/]*@/, "//***@").replace(/\?.*$/, "");

async function main() {
  if (!TARGET) throw new Error("MONGODB_URI is not set in .env");
  if (TARGET === SOURCE) throw new Error("Source and target are the same database. Nothing to copy.");
  console.log(`source: ${redact(SOURCE)}\ntarget: ${redact(TARGET)}${DRY ? "\n(dry run: nothing will be written)" : ""}`);
  const src = await mongoose.createConnection(SOURCE, { serverSelectionTimeoutMS: 15000 }).asPromise();
  const dst = await mongoose.createConnection(TARGET, { serverSelectionTimeoutMS: 15000 }).asPromise();
  try {
    const sdb = src.db!, ddb = dst.db!;
    const existing = new Set((await ddb.listCollections().toArray()).map((c) => c.name));
    for (const name of CATALOGUE) {
      const docs = await sdb.collection(name).find({}).toArray();
      const before = existing.has(name) ? await ddb.collection(name).countDocuments() : 0;
      if (!DRY && docs.length) {
        if (!existing.has(name)) throw new Error(`Target has no "${name}" collection. Run npm run ikonix:setup-db against the target first.`);
        for (let i = 0; i < docs.length; i += 500) {
          const chunk = docs.slice(i, i + 500);
          await ddb.collection(name).bulkWrite(chunk.map((d) => INSERT_ONLY.has(name)
            ? { updateOne: { filter: { _id: d._id }, update: { $setOnInsert: d }, upsert: true } }
            : { replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } }), { ordered: false });
        }
      }
      const after = DRY ? before : await ddb.collection(name).countDocuments();
      console.log(`${name.padEnd(18)} source ${String(docs.length).padStart(5)}   target before ${String(before).padStart(5)} -> after ${String(after).padStart(5)}`);
    }
    if (!DRY) {
      const p = await ddb.collection("products").countDocuments({ status: "ACTIVE", deletedAt: null });
      const cloud = await ddb.collection("media_assets").countDocuments({ url: /^https:\/\/res\.cloudinary\.com\// });
      console.log(`\nverify: ${p} active products, ${cloud} Cloudinary-hosted images on target`);
    }
  } finally { await src.close(); await dst.close(); }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; });
