import { Schema, type InferSchemaType } from "mongoose";
import { ObjectId, defineModel, int } from "./_shared";

// One document per variant. Available to sell = onHand - reserved.
// Written ONLY with conditional atomic updates (see src/server/inventory), e.g. reserve q units:
//   updateOne({ variantId, $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, q] } }, { $inc: { reserved: q } })
// A collection-level validator (scripts/ikonix/setup-db.ts) also rejects onHand < 0, reserved < 0, reserved > onHand.
const inventorySchema = new Schema(
  {
    variantId: { type: ObjectId, required: true, unique: true },
    productId: { type: ObjectId, ref: "Product", required: true },
    sku: { type: String, required: true },
    onHand: { ...int(0), default: 0 },
    reserved: { ...int(0), default: 0 },
    lowStockThreshold: { ...int(0), default: 5 },
    // The legacy site never tracked quantities, only an in/out-of-stock flag. Until real counts are
    // entered and `tracked` is switched on, availability comes from `manualAvailability`
    // (seeded from the legacy flag). When tracked, available = onHand - reserved and checkout reserves stock.
    tracked: { type: Boolean, default: false },
    manualAvailability: { type: String, enum: ["IN_STOCK", "OUT_OF_STOCK"], default: "OUT_OF_STOCK" },
  },
  { timestamps: true },
);
inventorySchema.index({ productId: 1 });
inventorySchema.index({ onHand: 1 });
export type InventoryDoc = InferSchemaType<typeof inventorySchema>;
export const Inventory = defineModel("Inventory", inventorySchema, "inventory");

export const MOVEMENT_TYPES = ["IMPORT", "RECEIPT", "ADJUSTMENT", "RESERVE", "RELEASE", "SALE", "RETURN", "CORRECTION"] as const;

const movementSchema = new Schema(
  {
    variantId: { type: ObjectId, required: true },
    productId: { type: ObjectId, ref: "Product", required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    onHandDelta: { type: Number, default: 0 },
    reservedDelta: { type: Number, default: 0 },
    onHandAfter: { type: Number, required: true },
    reservedAfter: { type: Number, required: true },
    orderId: { type: ObjectId, ref: "Order", default: null },
    reason: String,
    actorUserId: { type: ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
movementSchema.index({ variantId: 1, createdAt: -1 });
movementSchema.index({ orderId: 1 });
export type InventoryMovementDoc = InferSchemaType<typeof movementSchema>;
export const InventoryMovement = defineModel("InventoryMovement", movementSchema, "inventory_movements");
