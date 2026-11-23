import "server-only";
import mongoose from "mongoose";
import "./models"; // register every Ikonix model before any query

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
declare global {
  var __ikxMongoose: Cache | undefined;
}
const cache: Cache = (globalThis.__ikxMongoose ??= { conn: null, promise: null });

/** Shared connection, reused across hot reloads and requests. Schema/indexes are owned by setup-db.ts. */
export async function db(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  cache.promise ??= mongoose.connect(uri, { bufferCommands: false, autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10_000 });
  try {
    cache.conn = await cache.promise;
  } catch (e) {
    cache.promise = null;
    throw e;
  }
  return cache.conn;
}
