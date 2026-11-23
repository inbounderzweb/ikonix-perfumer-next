// Shared helpers for the bulk-upload CLI. Run every script with the react-server condition (see README.md).
import "../ikonix/_env"; // loads .env exactly like Next.js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import mongoose from "mongoose";
import { db } from "../../src/server/db";
import { authenticateStaff, type StaffIdentity } from "../../src/server/auth/admin-credentials";
import type { ImageLoader } from "../../src/server/catalogue/bulk-import";

export const ROOT = process.cwd();
export const SOURCE_FILE = path.resolve(ROOT, process.argv.slice(2).find((a) => a.startsWith("--source="))?.slice(9) ?? "public/ikonix/export/all-products.json");
export const REPORT_DIR = path.join(ROOT, "audit/bulk-upload");
export const EXPECTED_CLOUD = process.env.BULK_EXPECT_CLOUD ?? "iombhcei";
export const args = new Set(process.argv.slice(2));
export const flag = (name: string) => args.has(`--${name}`);
export const option = (name: string) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

export const redact = (uri: string) => uri.replace(/\/\/[^@/]*@/, "//***@").replace(/\?.*$/, "");

/** Refuses to run against local MongoDB or the wrong Cloudinary account unless explicitly allowed. */
export async function connectTarget(opts: { needCloudinary?: boolean } = {}) {
  const uri = process.env.MONGODB_URI ?? "";
  if (!uri) throw new Error("MONGODB_URI is not set in .env");
  const local = /\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])[:/]/.test(uri);
  if (local && !flag("allow-local")) throw new Error("MONGODB_URI points at a local database. This tool targets MongoDB Atlas; pass --allow-local only for a deliberate local test.");
  if (opts.needCloudinary) {
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    if (cloud !== EXPECTED_CLOUD) throw new Error(`CLOUDINARY_CLOUD_NAME is "${cloud ?? "unset"}", expected "${EXPECTED_CLOUD}" (the account that holds the catalogue).`);
  }
  await db();
  console.log(`target: ${redact(uri)} (db ${mongoose.connection.db?.databaseName})${opts.needCloudinary ? `, cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME}` : ""}`);
}

export const disconnect = () => mongoose.disconnect();

/** Admin sign-in from BULK_ADMIN_EMAIL / BULK_ADMIN_PASSWORD (never hard-coded, never printed). */
export async function signInAdmin(): Promise<StaffIdentity> {
  const email = process.env.BULK_ADMIN_EMAIL ?? "";
  const password = process.env.BULK_ADMIN_PASSWORD ?? "";
  if (!email || !password) throw new Error("Set BULK_ADMIN_EMAIL and BULK_ADMIN_PASSWORD (environment or .env.local) to an admin login.");
  const admin = await authenticateStaff(email, password);
  if (!admin) throw new Error("Admin sign-in failed (wrong email/password, inactive or locked account).");
  for (const p of ["products.write", "media.write"] as const) if (!admin.permissions.has(p)) throw new Error(`Admin ${admin.email} lacks the "${p}" permission.`);
  console.log(`signed in: ${admin.email} (${admin.roleKeys.join(", ")})`);
  return admin;
}

export const auditMeta = { ip: null, userAgent: `bulk-upload-cli (${os.hostname()})` };

export function readSource(): unknown[] {
  const data = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8")) as { products?: unknown[] } | unknown[];
  const list = Array.isArray(data) ? data : data.products;
  if (!Array.isArray(list)) throw new Error(`${path.relative(ROOT, SOURCE_FILE)} has no products array`);
  const only = option("only")?.split(",").map((s) => s.trim());
  return only ? list.filter((p) => only.includes(String((p as { id?: unknown }).id))) : list;
}

/** Reads source images from public/ (read-only; originals are never modified or deleted). */
export const diskLoader: ImageLoader = async (p) => {
  const abs = path.join(ROOT, "public", p);
  if (!abs.startsWith(path.join(ROOT, "public", "ikonix", "products") + path.sep)) return null;
  try { return { buffer: await fs.promises.readFile(abs), filename: path.basename(p) }; } catch { return null; }
};

export const sha256File = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, "public", p))).digest("hex");

export async function pool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>, onDone?: (done: number) => void): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); onDone?.(++done); }
  }));
  return out;
}

export function writeReport(name: string, data: unknown) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const file = path.join(REPORT_DIR, name);
  fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n");
  return path.relative(ROOT, file);
}

export function readReport<T>(name: string): T | null {
  try { return JSON.parse(fs.readFileSync(path.join(REPORT_DIR, name), "utf8")) as T; } catch { return null; }
}

export const progress = (label: string, total: number) => (done: number) => {
  if (done === total || done % 25 === 0) process.stdout.write(`  ${label} ${done}/${total}\n`);
};
