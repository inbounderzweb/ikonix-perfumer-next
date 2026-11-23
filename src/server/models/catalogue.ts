import { Schema, type InferSchemaType } from "mongoose";
import { ACTIVE_STATUS, ObjectId, defineModel, int, money, seoSchema } from "./_shared";

// ── Brand ──────────────────────────────────────────────────────────────────
// HOUSE = the seller's own brand (Ikonix). INSPIRATION = designer brand a fragrance is inspired by.
const brandSchema = new Schema(
  {
    kind: { type: String, enum: ["HOUSE", "INSPIRATION"], required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: String,
    logoUrl: String,
    status: { type: String, enum: ACTIVE_STATUS, default: "ACTIVE" },
    seo: { type: seoSchema, default: () => ({}) },
    deletedAt: Date,
  },
  { timestamps: true },
);
brandSchema.index({ kind: 1, status: 1, name: 1 });
export type BrandDoc = InferSchemaType<typeof brandSchema>;
export const Brand = defineModel("Brand", brandSchema, "brands");

// ── Category (tree via parentId) ───────────────────────────────────────────
const categorySchema = new Schema(
  {
    parentId: { type: ObjectId, ref: "Category", default: null },
    legacyId: String,
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    description: String,
    imageUrl: String,
    sortOrder: { ...int(0), default: 0 },
    status: { type: String, enum: ACTIVE_STATUS, default: "ACTIVE" },
    seo: { type: seoSchema, default: () => ({}) },
    deletedAt: Date,
  },
  { timestamps: true },
);
categorySchema.index({ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: "string" } } });
categorySchema.index({ parentId: 1, sortOrder: 1 });
export type CategoryDoc = InferSchemaType<typeof categorySchema>;
export const Category = defineModel("Category", categorySchema, "categories");

// ── Product (variants + images embedded) ───────────────────────────────────
const variantSchema = new Schema(
  {
    legacyId: String, // `vid` on the legacy site
    sku: { type: String, required: true, trim: true },
    sizeValue: Number,
    sizeUnit: { type: String, default: "ml" },
    label: { type: String, required: true }, // "30 ml"
    regularPrice: { ...money(), required: true }, // MRP
    salePrice: { ...money(), required: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { ...int(0), default: 0 },
    weightGrams: int(0),
    dimensionsMm: { length: int(0), width: int(0), height: int(0) },
    barcode: String,
    // Problems found in source data; an active variant must have none (see validator below).
    issues: { type: [String], default: [] },
  },
  { timestamps: true },
);
// A variant that can be sold must have a coherent price. Invalid legacy prices are kept, inactive, for correction.
variantSchema.pre("validate", function () {
  if (this.isActive && this.salePrice > this.regularPrice) {
    this.invalidate("salePrice", `salePrice (${this.salePrice}) exceeds regularPrice (${this.regularPrice}) on an active variant`);
  }
});

const imageSchema = new Schema({
  variantId: { type: ObjectId, default: null }, // set when the photo shows a specific size
  storageKey: { type: String, required: true }, // R2 key in production; path under public/ in development
  url: { type: String, required: true },
  alt: String,
  width: { ...int(1), required: true },
  height: { ...int(1), required: true },
  bytes: int(0),
  sha256: String,
  sortOrder: { ...int(0), default: 0 },
  sourceUrl: String, // legacy origin
});

export const PRODUCT_STATUS = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export const GENDERS = ["MEN", "WOMEN", "UNISEX"] as const;

const productSchema = new Schema(
  {
    legacyId: String, // id on ikonixperfumer.com; drives /product-details/:pid redirects
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    subtitle: String,
    description: String,
    shortDescription: String,
    status: { type: String, enum: PRODUCT_STATUS, default: "DRAFT" },
    brandId: { type: ObjectId, ref: "Brand", default: null },
    inspiredByBrandId: { type: ObjectId, ref: "Brand", default: null },
    inspiredByName: String,
    categoryIds: { type: [{ type: ObjectId, ref: "Category" }], default: [] },
    primaryCategoryId: { type: ObjectId, ref: "Category", default: null },
    concentration: String, // EDP / EDT / Parfum: not in legacy data
    gender: { type: String, enum: [...GENDERS, null], default: null },
    fragranceFamily: String,
    launchYear: Number,
    perfumers: { type: [String], default: [] },
    notes: {
      top: { type: [String], default: [] },
      middle: { type: [String], default: [] },
      base: { type: [String], default: [] },
    },
    ingredients: { type: [String], default: [] },
    variants: { type: [variantSchema], default: [] },
    images: { type: [imageSchema], default: [] },
    primaryImageId: { type: ObjectId, default: null },
    seo: { type: seoSchema, default: () => ({}) },
    // Denormalised for listing sort/filter; recomputed on every save (see pre-save) and by order/review services.
    minSalePrice: money(),
    maxDiscountBps: int(0),
    soldCount: { ...int(0), default: 0 },
    ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
    ratingCount: { ...int(0), default: 0 },
    // Source-data problems that keep the product in DRAFT until an admin resolves them.
    reviewIssues: { type: [String], default: [] },
    legacy: { stockStatus: String, sourceUrl: String }, // the legacy API only exposed in/out of stock
    publishedAt: Date,
    deletedAt: Date,
  },
  { timestamps: true },
);
type PricedVariant = { isActive?: boolean | null; salePrice: number; regularPrice: number };
productSchema.pre("save", function () {
  const active = (this.variants as unknown as PricedVariant[]).filter((v) => v.isActive);
  this.minSalePrice = active.length ? Math.min(...active.map((v) => v.salePrice)) : undefined;
  const bps = active.filter((v) => v.regularPrice > 0).map((v) => Math.round(((v.regularPrice - v.salePrice) / v.regularPrice) * 10000));
  this.maxDiscountBps = bps.length ? Math.max(0, ...bps) : undefined;
});
productSchema.index({ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $type: "string" } } });
productSchema.index({ "variants.sku": 1 }, { unique: true }); // unique across all products
productSchema.index({ "variants.legacyId": 1 }, { unique: true, partialFilterExpression: { "variants.legacyId": { $type: "string" } } });
productSchema.index({ status: 1, deletedAt: 1, publishedAt: -1 });
productSchema.index({ categoryIds: 1, status: 1 });
productSchema.index({ inspiredByBrandId: 1, status: 1 });
productSchema.index({ gender: 1, status: 1 });
productSchema.index({ minSalePrice: 1 });
productSchema.index({ soldCount: -1 });
productSchema.index({ maxDiscountBps: -1 });
productSchema.index(
  { name: "text", inspiredByName: "text", subtitle: "text", "variants.sku": "text" },
  { weights: { name: 10, inspiredByName: 6, subtitle: 3, "variants.sku": 8 }, name: "product_search" },
);
export type ProductDoc = InferSchemaType<typeof productSchema>;
export const Product = defineModel("Product", productSchema, "products");

// ── Collection (Featured, Best Sellers, New Arrivals …) ────────────────────
const collectionSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: String,
    status: { type: String, enum: ACTIVE_STATUS, default: "ACTIVE" },
    productIds: { type: [{ type: ObjectId, ref: "Product" }], default: [] }, // ordered
  },
  { timestamps: true },
);
export type CollectionDoc = InferSchemaType<typeof collectionSchema>;
export const ProductCollection = defineModel("ProductCollection", collectionSchema, "collections");
