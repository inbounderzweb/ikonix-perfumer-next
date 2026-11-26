import { Schema, type InferSchemaType } from "mongoose";
import { ACTIVE_STATUS, ObjectId, defineModel, int, money } from "./_shared";
import { SHIPMENT_STATUS } from "../../lib/shipment-tracking";

// ── Shipping methods (legacy "delivery-methods"; values are admin data, pending legacy source) ──
const shippingMethodSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: String,
    charge: { ...money(), required: true },
    freeAboveSubtotal: money(), // legacy UI advertises free delivery over ₹1,099
    countries: { type: [String], default: [] }, // ISO alpha-2; empty = all
    minDays: int(0),
    maxDays: int(0),
    status: { type: String, enum: ACTIVE_STATUS, default: "ACTIVE" },
    sortOrder: { ...int(0), default: 0 },
  },
  { timestamps: true },
);
export type ShippingMethodDoc = InferSchemaType<typeof shippingMethodSchema>;
export const ShippingMethod = defineModel("ShippingMethod", shippingMethodSchema, "shipping_methods");

// ── Order ──────────────────────────────────────────────────────────────────
export const ORDER_STATUS = [
  "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY",
  "DELIVERED", "DELIVERY_FAILED", "CANCELLED", "RETURN_REQUESTED", "RETURNED", "REFUNDED",
] as const;
export const PAYMENT_STATUS = ["CREATED", "PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export const ACTOR_TYPES = ["SYSTEM", "CUSTOMER", "ADMIN", "WEBHOOK"] as const;

const addressSnapshotSchema = new Schema(
  {
    fullName: String, phone: String, line1: String, line2: String, landmark: String, city: String,
    district: String, state: String, postalCode: String, country: String, company: String, gstin: String,
  },
  { _id: false },
);

// Snapshot of what was bought, at the price paid. Never re-read from the catalogue.
const orderItemSchema = new Schema({
  // Required for every line sold by this site. Lines imported from the previous site whose product no longer exists are snapshot-only.
  productId: { type: ObjectId, ref: "Product", required: [function (this: { snapshotOnly?: boolean }) { return !this.snapshotOnly; }, "productId is required"] },
  variantId: { type: ObjectId, required: [function (this: { snapshotOnly?: boolean }) { return !this.snapshotOnly; }, "variantId is required"] },
  snapshotOnly: { type: Boolean, default: false },
  legacy: { type: Schema.Types.Mixed, default: undefined }, // original order-item row ids (audit)
  sku: { type: String, required: true },
  productName: { type: String, required: true },
  variantLabel: { type: String, required: true },
  imageUrl: String,
  unitRegularPrice: { ...money(), required: true },
  unitSalePrice: { ...money(), required: true },
  quantity: { ...int(0), required: true }, // paid units
  freeQuantity: { ...int(0), default: 0 }, // units given free by a promotion
  lineDiscount: { ...money(), default: 0 },
  lineTotal: { ...money(), required: true }, // unitSalePrice * quantity - lineDiscount
  taxAmount: { ...money(), default: 0 },
  // Buy X Get Y snapshot (offer id, X/Y, pricing basis, savings) so the order stays explainable after the offer changes or is deleted.
  offer: { type: Schema.Types.Mixed, default: null },
});

const statusChangeSchema = new Schema(
  {
    from: { type: String, enum: [...ORDER_STATUS, null], default: null },
    to: { type: String, enum: ORDER_STATUS, required: true },
    note: String, // internal (staff only)
    description: { type: String, maxlength: 500 }, // customer-visible update written by staff
    actorType: { type: String, enum: ACTOR_TYPES, required: true },
    actorUserId: { type: ObjectId, ref: "User", default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const shipmentSchema = new Schema(
  {
    carrier: { type: String, required: true },
    trackingNumber: String,
    trackingUrl: String,
    status: { type: String, enum: SHIPMENT_STATUS, default: "PENDING" },
    estimatedDeliveryDate: Date, // only ever set by staff or a verified courier integration
    shippedAt: Date,
    deliveredAt: Date,
    // Automated courier tracking (see src/server/shipping). Absent on shipments that are only updated by hand.
    trackingEnabled: { type: Boolean, default: false },
    trackingEnrolledAt: Date,
    trackingBackfillPending: Boolean, // history since shipping still has to be read
    lastTrackingCheckAt: Date,
    nextTrackingCheckAt: Date,
    lastEventAt: Date,
    lastEventCode: String,
    lastEventDescription: String,
    lastEventOffice: String,
    statusEventKey: String, // event that produced `status`; the order is only touched when this changes
    trackingError: String,
    retryCount: { ...int(0), default: 0 },
    trackingFailed: { type: Boolean, default: false }, // retry limit reached: waits for a manual retry
  },
  { timestamps: true },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true }, // IKX-YYMMDD-NNNNN
    userId: { type: ObjectId, ref: "User", default: null }, // null = guest checkout
    status: { type: String, enum: ORDER_STATUS, default: "PENDING" },
    paymentStatus: { type: String, enum: PAYMENT_STATUS, default: "CREATED" },
    currency: { type: String, default: "INR" },
    items: { type: [orderItemSchema], validate: [(v: unknown[]) => v.length > 0, "An order needs at least one item"] },
    subtotal: { ...money(), required: true },
    discountTotal: { ...money(), default: 0 },
    shippingTotal: { ...money(), default: 0 },
    packingTotal: { ...money(), default: 0 },
    taxTotal: { ...money(), default: 0 },
    grandTotal: { ...money(), required: true },
    couponCode: String,
    pricingSnapshot: { type: Schema.Types.Mixed, required: true }, // full pricing-engine output
    contact: { name: { type: String, required: true }, email: String, phone: { type: String, required: true } },
    shippingAddress: { type: addressSnapshotSchema, required: true },
    billingAddress: { type: addressSnapshotSchema, required: true },
    shippingMethodId: { type: ObjectId, ref: "ShippingMethod", default: null },
    shippingMethodName: { type: String, required: true },
    customerNote: String,
    idempotencyKey: { type: String, required: true, unique: true }, // one order per checkout attempt
    accessTokenHash: { type: String, select: false }, // guest order-view token (SHA-256); the token itself is only in the customer's URL
    reservationExpiresAt: Date, // unpaid orders release stock after this
    statusHistory: { type: [statusChangeSchema], default: [] },
    shipments: { type: [shipmentSchema], default: [] },
    placedAt: { type: Date, default: Date.now },
    confirmedAt: Date,
    cancelledAt: Date,
    cancelReason: String,
    deliveredAt: Date,
    ipAddress: String,
    userAgent: String,
    // Present only on orders imported from the previous site: original ids/status/address text for audit. Imported orders are read-only history.
    legacy: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true },
);
orderSchema.pre("validate", function () {
  type Line = { quantity: number; freeQuantity: number; unitSalePrice: number; lineDiscount: number; lineTotal: number };
  for (const [i, it] of (this.items as unknown as Line[]).entries()) {
    if (it.lineTotal !== it.unitSalePrice * it.quantity - it.lineDiscount) this.invalidate(`items.${i}.lineTotal`, "lineTotal is inconsistent");
    if (it.quantity + it.freeQuantity <= 0) this.invalidate(`items.${i}.quantity`, "An order line needs at least one unit");
  }
  const expected = this.subtotal - this.discountTotal + this.shippingTotal + this.packingTotal + this.taxTotal;
  if (this.grandTotal !== expected) this.invalidate("grandTotal", `grandTotal ${this.grandTotal} != ${expected}`);
});
orderSchema.index({ userId: 1, placedAt: -1 });
orderSchema.index({ status: 1, placedAt: -1 });
orderSchema.index({ paymentStatus: 1, placedAt: -1 });
orderSchema.index({ "contact.phone": 1 });
orderSchema.index({ reservationExpiresAt: 1 }, { partialFilterExpression: { status: "PENDING" } });
orderSchema.index({ "items.productId": 1 });
orderSchema.index({ "shipments.trackingNumber": 1 });
orderSchema.index({ "shipments.trackingEnabled": 1, "shipments.nextTrackingCheckAt": 1 });
orderSchema.index({ "shipments.status": 1 });
orderSchema.index({ "legacy.source": 1, "legacy.orderId": 1 }, { unique: true, partialFilterExpression: { "legacy.orderId": { $type: "number" } } });
export type OrderDoc = InferSchemaType<typeof orderSchema>;
export const Order = defineModel("Order", orderSchema, "orders");

// ── Payment (Razorpay) ─────────────────────────────────────────────────────
const paymentSchema = new Schema(
  {
    orderId: { type: ObjectId, ref: "Order", required: true },
    provider: { type: String, enum: ["RAZORPAY"], default: "RAZORPAY" },
    providerOrderId: { type: String, required: true, unique: true },
    providerPaymentId: String,
    method: String, // upi | card | netbanking | wallet | emi
    methodDetail: String, // UPI app / card network; never card numbers
    amount: { ...money(), required: true, min: 1 },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: PAYMENT_STATUS, default: "CREATED" },
    signatureVerifiedAt: Date,
    failureCode: String,
    failureReason: String,
    capturedAt: Date,
    legacy: { type: Schema.Types.Mixed, default: undefined }, // imported from the previous site (no amount was stored there: amount is reconstructed from the order)
  },
  { timestamps: true },
);
paymentSchema.index({ "legacy.source": 1, "legacy.paymentId": 1 }, { unique: true, partialFilterExpression: { "legacy.paymentId": { $type: "number" } } });
paymentSchema.index({ providerPaymentId: 1 }, { unique: true, partialFilterExpression: { providerPaymentId: { $type: "string" } } });
paymentSchema.index({ orderId: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
export type PaymentDoc = InferSchemaType<typeof paymentSchema>;
export const Payment = defineModel("Payment", paymentSchema, "payments");

// Stored before processing; unique event id = duplicate-delivery protection.
const webhookEventSchema = new Schema(
  {
    provider: { type: String, enum: ["RAZORPAY", "SMS"], required: true },
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    signatureValid: { type: Boolean, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    processedAt: Date,
    processingError: String,
    attempts: { ...int(0), default: 0 },
  },
  { timestamps: { createdAt: "receivedAt", updatedAt: true } },
);
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ processedAt: 1 });
export type WebhookEventDoc = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEvent = defineModel("WebhookEvent", webhookEventSchema, "webhook_events");

const refundSchema = new Schema(
  {
    orderId: { type: ObjectId, ref: "Order", required: true },
    paymentId: { type: ObjectId, ref: "Payment", required: true },
    providerRefundId: String,
    amount: { ...money(), required: true, min: 1 },
    status: { type: String, enum: ["REQUESTED", "PENDING", "PROCESSED", "FAILED"], default: "REQUESTED" },
    reason: String,
    initiatedById: { type: ObjectId, ref: "User", default: null },
    processedAt: Date,
  },
  { timestamps: true },
);
refundSchema.index({ providerRefundId: 1 }, { unique: true, partialFilterExpression: { providerRefundId: { $type: "string" } } });
refundSchema.index({ orderId: 1 });
export type RefundDoc = InferSchemaType<typeof refundSchema>;
export const Refund = defineModel("Refund", refundSchema, "refunds");

const returnRequestSchema = new Schema(
  {
    orderId: { type: ObjectId, ref: "Order", required: true },
    orderItemId: { type: ObjectId, default: null },
    quantity: { ...int(1), required: true },
    reason: { type: String, required: true },
    status: { type: String, enum: ["REQUESTED", "APPROVED", "REJECTED", "RECEIVED", "REFUNDED", "CANCELLED"], default: "REQUESTED" },
    adminNote: String,
    resolvedAt: Date,
  },
  { timestamps: true },
);
returnRequestSchema.index({ orderId: 1 });
returnRequestSchema.index({ status: 1, createdAt: -1 });
export type ReturnRequestDoc = InferSchemaType<typeof returnRequestSchema>;
export const ReturnRequest = defineModel("ReturnRequest", returnRequestSchema, "return_requests");

// Atomic sequences (order numbers): findOneAndUpdate({ _id }, { $inc: { seq: 1 } }, { upsert: true }).
const counterSchema = new Schema({ _id: { type: String }, seq: { ...int(0), default: 0 } });
export type CounterDoc = InferSchemaType<typeof counterSchema>;
export const Counter = defineModel("Counter", counterSchema, "counters");
