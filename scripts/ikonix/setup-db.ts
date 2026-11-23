// Creates Ikonix collections with server-side validators and builds every index declared in the models.
// Idempotent: safe to re-run after schema changes.   Usage: npx tsx scripts/ikonix/setup-db.ts
import { connect, disconnect } from "./_env";
import * as models from "../../src/server/models";

const num = { bsonType: ["int", "long", "double", "decimal"] };

// Rules enforced by MongoDB itself on every write, including raw updateOne/$inc that bypass Mongoose.
const validators: Record<string, object> = {
  inventory: {
    $and: [
      { $jsonSchema: { bsonType: "object", required: ["variantId", "productId", "sku", "onHand", "reserved"], properties: { onHand: { ...num, minimum: 0 }, reserved: { ...num, minimum: 0 }, lowStockThreshold: { ...num, minimum: 0 } } } },
      { $expr: { $lte: ["$reserved", "$onHand"] } },
    ],
  },
  products: {
    // Every *active* variant must have salePrice <= regularPrice, and prices are non-negative.
    $expr: {
      $allElementsTrue: [{
        $map: {
          input: { $ifNull: ["$variants", []] },
          as: "v",
          in: { $and: [
            { $gte: ["$$v.salePrice", 0] }, { $gte: ["$$v.regularPrice", 0] },
            { $or: [{ $ne: ["$$v.isActive", true] }, { $lte: ["$$v.salePrice", "$$v.regularPrice"] }] },
          ] },
        },
      }],
    },
  },
  orders: {
    $expr: { $eq: ["$grandTotal", { $add: [{ $subtract: ["$subtotal", "$discountTotal"] }, "$shippingTotal", "$packingTotal", "$taxTotal"] }] },
  },
  product_reviews: { $jsonSchema: { bsonType: "object", required: ["rating"], properties: { rating: { ...num, minimum: 1, maximum: 5 } } } },
  promotions: {
    $expr: { $or: [{ $eq: [{ $ifNull: ["$usageLimitTotal", null] }, null] }, { $lte: ["$usageCount", "$usageLimitTotal"] }] },
  },
  payments: { $jsonSchema: { bsonType: "object", required: ["amount"], properties: { amount: { ...num, minimum: 1 } } } },
};

async function main() {
  const db = await connect();
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  for (const [name, validator] of Object.entries(validators)) {
    if (existing.has(name)) await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
    else await db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
    console.log(`validator: ${name}`);
  }

  // Structural type: avoids Mongoose's deep model generics (which also slow tsc down badly).
  type SyncableModel = {
    modelName: string;
    collection: { collectionName: string; indexes(): Promise<unknown[]> };
    createCollection(): Promise<unknown>;
    syncIndexes(): Promise<string[]>;
  };
  const ikxModels = (Object.values(models) as unknown[]).filter(
    (m) => typeof m === "function" && "modelName" in m && "syncIndexes" in m,
  ) as unknown as SyncableModel[];
  for (const model of ikxModels) {
    await model.createCollection().catch((e: { codeName?: string }) => { if (e.codeName !== "NamespaceExists") throw e; });
    const dropped = await model.syncIndexes();
    const idx = await model.collection.indexes();
    console.log(`indexes: ${model.collection.collectionName.padEnd(22)} ${idx.length}${dropped.length ? `  (dropped stale: ${dropped.join(", ")})` : ""}`);
  }
  console.log(`done: ${ikxModels.length} models`);
}

main().then(disconnect, async (e) => { console.error(e); await disconnect(); process.exit(1); });
