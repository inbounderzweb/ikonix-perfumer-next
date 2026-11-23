import { Schema, type InferSchemaType } from "mongoose";
import { ObjectId, defineModel, int } from "./_shared";

const addressSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["HOME", "WORK", "OTHER"], default: "HOME" },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: String,
    landmark: String,
    city: { type: String, required: true },
    district: String,
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, default: "IN", match: /^[A-Z]{2}$/ },
    company: String,
    gstin: { type: String, uppercase: true, trim: true },
    location: { lat: Number, lng: Number },
    deletedAt: Date,
  },
  { timestamps: true },
);
addressSchema.index({ userId: 1, deletedAt: 1 });
export type AddressDoc = InferSchemaType<typeof addressSchema>;
export const Address = defineModel("Address", addressSchema, "addresses");

const customerNoteSchema = new Schema(
  {
    customerId: { type: ObjectId, ref: "User", required: true },
    authorId: { type: ObjectId, ref: "User", default: null },
    body: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
customerNoteSchema.index({ customerId: 1, createdAt: -1 });
export type CustomerNoteDoc = InferSchemaType<typeof customerNoteSchema>;
export const CustomerNote = defineModel("CustomerNote", customerNoteSchema, "customer_notes");

// Signed-in carts only. Guest carts live in the browser and are merged on login.
const cartItemSchema = new Schema(
  {
    productId: { type: ObjectId, ref: "Product", required: true },
    variantId: { type: ObjectId, required: true },
    quantity: { ...int(1), required: true, max: 99 },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);
const cartSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, unique: true },
    items: { type: [cartItemSchema], default: [] },
    couponCode: { type: String, uppercase: true, trim: true },
  },
  { timestamps: true },
);
cartSchema.pre("validate", function () {
  const ids = (this.items as unknown as { variantId: unknown }[]).map((i) => String(i.variantId));
  if (new Set(ids).size !== ids.length) this.invalidate("items", "A variant may appear only once in a cart");
});
export type CartDoc = InferSchemaType<typeof cartSchema>;
export const Cart = defineModel("Cart", cartSchema, "carts");

const wishlistSchema = new Schema(
  {
    userId: { type: ObjectId, ref: "User", required: true, unique: true },
    items: {
      type: [new Schema({ productId: { type: ObjectId, ref: "Product", required: true }, variantId: ObjectId, addedAt: { type: Date, default: Date.now } }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);
wishlistSchema.index({ "items.productId": 1 });
export type WishlistDoc = InferSchemaType<typeof wishlistSchema>;
export const Wishlist = defineModel("Wishlist", wishlistSchema, "wishlists");

const recentlyViewedSchema = new Schema({
  userId: { type: ObjectId, ref: "User", required: true },
  productId: { type: ObjectId, ref: "Product", required: true },
  viewedAt: { type: Date, default: Date.now },
});
recentlyViewedSchema.index({ userId: 1, productId: 1 }, { unique: true });
recentlyViewedSchema.index({ userId: 1, viewedAt: -1 });
recentlyViewedSchema.index({ viewedAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });
export type RecentlyViewedDoc = InferSchemaType<typeof recentlyViewedSchema>;
export const RecentlyViewed = defineModel("RecentlyViewed", recentlyViewedSchema, "recently_viewed");
