import { Schema, type InferSchemaType } from "mongoose";
import { ACTIVE_STATUS, ObjectId, defineModel, int } from "./_shared";
import { ACTOR_TYPES } from "./commerce";

const reviewSchema = new Schema(
  {
    productId: { type: ObjectId, ref: "Product", required: true },
    userId: { type: ObjectId, ref: "User", required: true },
    orderId: { type: ObjectId, ref: "Order", default: null }, // set = verified purchase
    rating: { ...int(1), required: true, max: 5 },
    title: String,
    body: String,
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
  },
  { timestamps: true },
);
reviewSchema.index({ productId: 1, userId: 1 }, { unique: true });
reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
export type ReviewDoc = InferSchemaType<typeof reviewSchema>;
export const ProductReview = defineModel("ProductReview", reviewSchema, "product_reviews");

const bannerSchema = new Schema(
  {
    placement: { type: String, enum: ["HOME_HERO", "HOME_PROMO", "SHOP_TOP", "BRAND_SHOWCASE", "POPUP"], required: true },
    title: String,
    subtitle: String,
    ctaLabel: String,
    linkUrl: String,
    desktopImageUrl: { type: String, required: true },
    mobileImageUrl: { type: String, required: true },
    alt: { type: String, required: true },
    popupDelaySeconds: { ...int(0), default: 3 }, // POPUP only: seconds after page load
    popupFrequency: { type: String, enum: ["ALWAYS", "SESSION", "DAILY", "WEEKLY"], default: "SESSION" }, // POPUP only: how often one visitor sees it
    sortOrder: { ...int(0), default: 0 },
    status: { type: String, enum: ACTIVE_STATUS, default: "ACTIVE" },
    startsAt: Date,
    endsAt: Date,
    deletedAt: Date,
  },
  { timestamps: true },
);
bannerSchema.index({ placement: 1, status: 1, sortOrder: 1 });
export type BannerDoc = InferSchemaType<typeof bannerSchema>;
export const Banner = defineModel("Banner", bannerSchema, "banners");

const homepageSectionSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["HERO_BANNERS", "PRODUCT_CAROUSEL", "CATEGORY_TILES", "BRAND_STRIP", "PROMO_BANNERS", "CUSTOM_FRAGRANCE", "USP", "TESTIMONIALS", "INSTAGRAM"],
      required: true,
    },
    title: String,
    collectionId: { type: ObjectId, ref: "ProductCollection", default: null },
    config: Schema.Types.Mixed, // type-specific options, validated with Zod in the service
    sortOrder: { ...int(0), default: 0 },
    status: { type: String, enum: ACTIVE_STATUS, default: "ACTIVE" },
  },
  { timestamps: true },
);
homepageSectionSchema.index({ status: 1, sortOrder: 1 });
export type HomepageSectionDoc = InferSchemaType<typeof homepageSectionSchema>;
export const HomepageSection = defineModel("HomepageSection", homepageSectionSchema, "homepage_sections");

const notificationSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", default: null }, // null = staff audience
    audience: { type: String, enum: ["CUSTOMER", "ADMIN"], default: "CUSTOMER" },
    channel: { type: String, enum: ["SMS", "EMAIL", "WHATSAPP", "IN_APP"], required: true },
    template: { type: String, required: true }, // ORDER_CONFIRMED, PAYMENT_FAILED, LOW_STOCK, …
    dedupeKey: { type: String, required: true, unique: true }, // "ORDER_CONFIRMED:EMAIL:<orderId>"
    recipient: String,
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["PENDING", "SENT", "FAILED", "SKIPPED"], default: "PENDING" },
    attempts: { ...int(0), default: 0 },
    lastError: String,
    providerMessageId: String,
    scheduledAt: { type: Date, default: Date.now },
    sentAt: Date,
    readAt: Date,
  },
  { timestamps: true },
);
notificationSchema.index({ status: 1, scheduledAt: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ "payload.orderId": 1, createdAt: -1 });
export type NotificationDoc = InferSchemaType<typeof notificationSchema>;
export const Notification = defineModel("Notification", notificationSchema, "notifications");

const auditLogSchema = new Schema(
  {
    actorUserId: { type: ObjectId, ref: "User", default: null },
    actorType: { type: String, enum: ACTOR_TYPES, required: true },
    action: { type: String, required: true }, // "product.update", "order.refund", "role.grant"
    entityType: { type: String, required: true },
    entityId: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    ipAddress: String,
    userAgent: String,
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });
export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = defineModel("AuditLog", auditLogSchema, "audit_logs");

// Typed store configuration (tax rules, packing charge, OTP limits …), validated with Zod on read/write.
const settingSchema = new Schema(
  { _id: { type: String }, value: { type: Schema.Types.Mixed, required: true }, updatedById: { type: ObjectId, ref: "User", default: null } },
  { timestamps: true },
);
export type SettingDoc = InferSchemaType<typeof settingSchema>;
export const Setting = defineModel("Setting", settingSchema, "settings");

const redirectSchema = new Schema(
  {
    fromPath: { type: String, required: true, unique: true },
    toPath: { type: String, required: true },
    statusCode: { type: Number, enum: [301, 302, 307, 308], default: 301 },
    hits: { ...int(0), default: 0 },
  },
  { timestamps: true },
);
export type RedirectDoc = InferSchemaType<typeof redirectSchema>;
export const Redirect = defineModel("Redirect", redirectSchema, "redirects");

// ── Media library (Cloudinary assets; products reference these urls) ───────
const mediaSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true }, // Cloudinary public_id
    url: { type: String, required: true }, // https://res.cloudinary.com/<cloud>/image/upload/v…/<publicId>.<format>
    format: { type: String, required: true },
    width: { ...int(1), required: true },
    height: { ...int(1), required: true },
    bytes: { ...int(0), required: true },
    sha256: { type: String, required: true }, // content hash: identical uploads are de-duplicated
    folder: { type: String, default: "products" },
    filename: String, // original name, display only
    alt: { type: String, trim: true, maxlength: 300 },
    tags: { type: [String], default: [] },
    uploadedById: { type: ObjectId, ref: "User", default: null },
    legacySource: String, // e.g. original /ikonix/products/... path for migrated images
  },
  { timestamps: true },
);
mediaSchema.index({ sha256: 1 }, { unique: true });
mediaSchema.index({ createdAt: -1 });
mediaSchema.index({ folder: 1, createdAt: -1 });
mediaSchema.index({ filename: "text", alt: "text", tags: "text" }, { name: "media_search" });
export type MediaAssetDoc = InferSchemaType<typeof mediaSchema>;
export const MediaAsset = defineModel("MediaAsset", mediaSchema, "media_assets");
