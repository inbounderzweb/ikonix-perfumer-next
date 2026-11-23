// CLI bootstrap shared by Ikonix scripts: loads .env the same way Next.js does and connects Mongoose.
import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info() {}, error: console.error });

export async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set in .env");
  // Collections, validators and indexes are owned by setup-db.ts, never created implicitly at runtime.
  await mongoose.connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 10_000, autoCreate: false, autoIndex: false });
  const db = mongoose.connection.db!;
  console.log(`connected: ${mongoose.connection.host}:${mongoose.connection.port}/${db.databaseName}`);
  return db;
}

export async function disconnect() {
  await mongoose.disconnect();
}
