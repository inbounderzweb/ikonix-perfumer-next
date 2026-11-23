import { Schema, type InferSchemaType } from "mongoose";
import { ACTIVE_STATUS, ObjectId, defineModel, int, money } from "./_shared";

// Coupons and automatic offers share one engine (src/server/pricing), so they share one collection.
//   PERCENTAGE     value = basis points (1500 = 15%)
//   FIXED_AMOUNT   value = paise
//   BUY_X_GET_Y    buyQuantity + getQuantity at getDiscountBps off (10000 = free): B1G1, B2G1, B3G1
//   FREE_SHIPPING
const targetSchema = new Schema(
  {
    kind: { type: String, enum: ["PRODUCT", "VARIANT", "CATEGORY", "BRAND"], required: true },
    refId: { type: ObjectId, required: true },
  },
  { _id: false },
);

const promotionSchema = new Schema(
  {
    name: { type: String, required: true },
    description: String,
    trigger: { type: String, enum: ["COUPON", "AUTOMATIC"], required: true },
    code: { type: String, uppercase: true, trim: true },
    type: { type: String, enum: ["PERCENTAGE", "FIXED_AMOUNT", "BUY_X_GET_Y", "FREE_SHIPPING"], required: true },
    scope: { type: String, enum: ["ORDER", "TARGETS"], default: "ORDER" }, // TARGETS = only lines matching `targets`
    targets: { type: [targetSchema], default: [] },
    value: { ...int(0), default: 0 },
    maxDiscount: money(),
    minOrderValue: money(),
    buyQuantity: int(1),
    getQuantity: int(1),
    getDiscountBps: { ...int(1), max: 10000, default: 10000 },
    firstOrderOnly: { type: Boolean, default: false },
    customerSpecific: { type: Boolean, default: false }, // only users in promotion_customers
    stackable: { type: Boolean, default: false },
    priority: { ...int(0), default: 0 },
    usageLimitTotal: int(1),
    usageLimitPerCustomer: int(1),
    usageCount: { ...int(0), default: 0 },
    startsAt: Date,
    endsAt: Date,
    status: { type: String, enum: ACTIVE_STATUS, default: "ACTIVE" },
    deletedAt: Date,
  },
  { timestamps: true },
);
promotionSchema.pre("validate", function () {
  if (this.trigger === "COUPON" && !this.code) this.invalidate("code", "A coupon needs a code");
  if (this.type === "PERCENTAGE" && (this.value < 1 || this.value > 10000)) this.invalidate("value", "Percentage must be 0.01%–100%");
  if (this.type === "FIXED_AMOUNT" && this.value <= 0) this.invalidate("value", "Fixed discount must be positive");
  if (this.type === "BUY_X_GET_Y" && (!this.buyQuantity || !this.getQuantity)) this.invalidate("buyQuantity", "Buy X Get Y needs both quantities");
  if (this.scope === "TARGETS" && (this.targets as unknown as unknown[]).length === 0) this.invalidate("targets", "Targeted promotion needs at least one target");
  if (this.startsAt && this.endsAt && this.startsAt >= this.endsAt) this.invalidate("endsAt", "endsAt must be after startsAt");
  if (this.usageLimitTotal != null && this.usageCount > this.usageLimitTotal) this.invalidate("usageCount", "Usage exceeds limit");
});
promotionSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } });
promotionSchema.index({ trigger: 1, status: 1, startsAt: 1, endsAt: 1 });
export type PromotionDoc = InferSchemaType<typeof promotionSchema>;
export const Promotion = defineModel("Promotion", promotionSchema, "promotions");

const promotionCustomerSchema = new Schema({
  promotionId: { type: ObjectId, ref: "Promotion", required: true },
  userId: { type: ObjectId, ref: "User", required: true },
});
promotionCustomerSchema.index({ promotionId: 1, userId: 1 }, { unique: true });
export type PromotionCustomerDoc = InferSchemaType<typeof promotionCustomerSchema>;
export const PromotionCustomer = defineModel("PromotionCustomer", promotionCustomerSchema, "promotion_customers");

const redemptionSchema = new Schema(
  {
    promotionId: { type: ObjectId, ref: "Promotion", required: true },
    orderId: { type: ObjectId, ref: "Order", required: true },
    userId: { type: ObjectId, ref: "User", default: null },
    code: String,
    discountAmount: { ...money(), required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
redemptionSchema.index({ promotionId: 1, orderId: 1 }, { unique: true });
redemptionSchema.index({ promotionId: 1, userId: 1 });
export type PromotionRedemptionDoc = InferSchemaType<typeof redemptionSchema>;
export const PromotionRedemption = defineModel("PromotionRedemption", redemptionSchema, "promotion_redemptions");
