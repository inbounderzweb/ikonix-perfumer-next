import "server-only";
import { db } from "@/server/db";
import { RateLimitBucket } from "@/server/models";

/**
 * Fixed-window counter shared by every app instance (stored in Mongo, TTL-purged).
 * Returns false once `limit` hits inside the window. Fails CLOSED if the store is down for sensitive keys.
 */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  await db();
  const windowMs = windowSec * 1000;
  const start = Math.floor(Date.now() / windowMs) * windowMs;
  const doc = (await RateLimitBucket.findOneAndUpdate(
    { _id: `${key}:${start}` },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(start + windowMs * 2) } },
    { upsert: true, returnDocument: "after" },
  ).lean()) as { count: number } | null;
  return (doc?.count ?? 1) <= limit;
}
