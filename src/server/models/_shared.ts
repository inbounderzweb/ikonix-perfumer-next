// Shared building blocks for Ikonix Mongoose models.
//
// Conventions (see docs/rebuild/02-architecture.md §4):
// - Money is integer paise (INR minor units), matching Razorpay. Never floats.
// - Legacy ikonixperfumer.com ids are kept in `legacyId`.
// - Soft delete = `deletedAt`. Orders snapshot everything they price; they never read live prices.
// - Models must not import `server-only`: CLI scripts (import, setup) load them outside Next.js.
import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const { ObjectId } = Schema.Types;

/** Integer paise >= 0. */
// Spread these and set `required: true` inline in the schema literal: Mongoose only infers a
// non-optional type from a literal `required: true`, which a helper parameter would widen to boolean.
export const money = () => ({
  type: Number,
  min: 0,
  validate: { validator: Number.isInteger, message: "{PATH} must be integer paise" },
});

/** Integer >= min. */
export const int = (min = 0) => ({
  type: Number,
  min,
  validate: { validator: Number.isInteger, message: "{PATH} must be an integer" },
});

export const ACTIVE_STATUS = ["ACTIVE", "INACTIVE"] as const;

export const seoSchema = new Schema(
  { title: { type: String, trim: true }, description: { type: String, trim: true } },
  { _id: false },
);

/**
 * HMR-safe model registration. Throws if a *different* model already owns the name
 * (e.g. a leftover Fysit model), instead of silently returning the wrong one.
 */
declare global {
  var __ikxModelNames: Set<string> | undefined;
}
const owned = (globalThis.__ikxModelNames ??= new Set<string>());

// Typed by the schema (Mongoose infers the document type). Do NOT pass an explicit document type:
// forcing `mongoose.model<T>` against a generic `Schema` makes tsc exhaust its heap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = Schema<any, any, any, any, any, any, any, any, any>;
type ModelFor<S extends AnySchema> = ReturnType<typeof mongoose.model<InferSchemaType<S>>>;

export function defineModel<S extends AnySchema>(name: string, schema: S, collection: string): ModelFor<S> {
  const existing = mongoose.models[name];
  if (existing) {
    if (!owned.has(name) || existing.collection.collectionName !== collection) {
      throw new Error(`Mongoose model "${name}" is already registered by other code (collection "${existing.collection.collectionName}").`);
    }
    return existing as unknown as ModelFor<S>; // same Ikonix model, re-evaluated by hot reload
  }
  owned.add(name);
  return mongoose.model<InferSchemaType<S>>(name, schema as unknown as Schema<InferSchemaType<S>>, collection);
}
