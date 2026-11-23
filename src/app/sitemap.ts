import type { MetadataRoute } from "next";
import { db } from "@/server/db";
import { Product } from "@/server/models";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await db();
  const products = (await Product.find({ status: "ACTIVE", deletedAt: null }, "slug updatedAt").lean()) as unknown as { slug: string; updatedAt: Date }[];
  const pages = ["", "/shop", "/about", "/contact"].map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.8 }));
  return [...pages, ...products.map((p) => ({ url: `${SITE_URL}/products/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: 0.7 }))];
}
