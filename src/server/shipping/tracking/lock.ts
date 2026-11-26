import "server-only";
import { randomUUID } from "node:crypto";
import { JobLock } from "@/server/models";

export type Lock = { renew(): Promise<boolean>; release(): Promise<void> };

/** Mongo-backed lock shared by every app instance and worker. Returns null while someone else holds it. */
export async function acquireLock(name: string, ttlMs: number): Promise<Lock | null> {
  const owner = randomUUID();
  const until = () => new Date(Date.now() + ttlMs);
  try {
    // Matches only a missing or expired lock; a live one makes the upsert collide on _id.
    await JobLock.findOneAndUpdate({ _id: name, expiresAt: { $lte: new Date() } }, { $set: { owner, expiresAt: until() } }, { upsert: true });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return null;
    throw e;
  }
  return {
    renew: async () => (await JobLock.updateOne({ _id: name, owner }, { $set: { expiresAt: until() } })).matchedCount === 1,
    release: async () => { await JobLock.deleteOne({ _id: name, owner }); },
  };
}
