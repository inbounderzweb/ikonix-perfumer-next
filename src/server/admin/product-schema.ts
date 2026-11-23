import { z } from "zod";

const oid = z.string().regex(/^[a-f0-9]{24}$/, "Invalid id");
const rupees = z.coerce.number().min(0).max(10_000_000)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most 2 decimal places");
const tagList = z.array(z.string().trim().min(1).max(60)).max(30);

export const variantInput = z.object({
  id: oid.optional(), // existing variant
  sku: z.string().trim().min(3).max(60).regex(/^[A-Za-z0-9._-]+$/, "Letters, digits, . _ - only"),
  label: z.string().trim().min(1).max(30),
  sizeValue: z.coerce.number().positive().max(100000).optional(),
  regularPrice: rupees,
  salePrice: rupees,
  isActive: z.boolean(),
  tracked: z.boolean(),
  onHand: z.coerce.number().int().min(0).max(1_000_000),
  availability: z.enum(["IN_STOCK", "OUT_OF_STOCK"]),
});

export const productInput = z.object({
  id: oid.optional(),
  name: z.string().trim().min(2).max(200),
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Lowercase letters, digits and hyphens"),
  subtitle: z.string().trim().max(200).default(""),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  gender: z.enum(["MEN", "WOMEN", "UNISEX", ""]).default(""),
  inspiredByName: z.string().trim().max(120).default(""),
  categoryIds: z.array(oid).max(10),
  description: z.string().trim().max(10_000).default(""),
  shortDescription: z.string().trim().max(500).default(""),
  notes: z.object({ top: tagList, middle: tagList, base: tagList }),
  seo: z.object({ title: z.string().trim().max(70).default(""), description: z.string().trim().max(200).default("") }),
  variants: z.array(variantInput).min(1, "Add at least one size").max(20),
  images: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("media"), mediaId: oid, alt: z.string().trim().max(300).optional() }),
    z.object({ kind: z.literal("existing"), id: oid, alt: z.string().trim().max(300).optional() }),
  ])).max(20),
});
export type ProductInput = z.input<typeof productInput>;
export type ProductParsed = z.output<typeof productInput>;
export const toPaise = (r: number) => Math.round(r * 100);
