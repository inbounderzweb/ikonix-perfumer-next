import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Address, User } from "@/server/models";
import { addressInput, fieldErrors } from "./schemas";

export const MAX_ADDRESSES = 10;
export type AddressDTO = { id: string; type: "HOME" | "WORK" | "OTHER"; fullName: string; phone: string; line1: string; line2: string; landmark: string; city: string; state: string; country: string; postalCode: string; isDefault: boolean };
type Lean = { _id: Types.ObjectId; type: AddressDTO["type"]; fullName: string; phone: string; line1: string; line2?: string; landmark?: string; city: string; state: string; country?: string; postalCode: string };
const dto = (a: Lean, def: string | null): AddressDTO => ({ id: String(a._id), type: a.type, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2 ?? "", landmark: a.landmark ?? "", city: a.city, state: a.state, country: a.country ?? "IN", postalCode: a.postalCode, isDefault: String(a._id) === def });

export async function listAddresses(userId: string): Promise<AddressDTO[]> {
  await db();
  const [rows, u] = await Promise.all([
    Address.find({ userId, deletedAt: null }).sort({ createdAt: -1 }).lean() as unknown as Promise<Lean[]>,
    User.findById(userId, "defaultAddressId").lean() as unknown as Promise<{ defaultAddressId?: Types.ObjectId | null } | null>,
  ]);
  const def = u?.defaultAddressId ? String(u.defaultAddressId) : null;
  return rows.map((r) => dto(r, def)).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

export type AddressResult = { ok: true; address: AddressDTO } | { ok: false; error: string; fields?: Record<string, string> };

/** Every query is scoped by the session user's id: another customer's address id simply doesn't match (no IDOR). */
export async function saveAddress(userId: string, raw: unknown): Promise<AddressResult> {
  const p = addressInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Please check the highlighted fields.", fields: fieldErrors(p.error) };
  const { id, makeDefault, ...a } = p.data;
  await db();
  const fields = { type: a.type, fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2 || undefined, landmark: a.landmark || undefined, city: a.city, state: a.state, country: a.country, postalCode: a.postalCode };
  let doc: Lean | null;
  if (id) {
    doc = (await Address.findOneAndUpdate({ _id: id, userId, deletedAt: null }, { $set: fields, $unset: { ...(a.line2 ? {} : { line2: 1 }), ...(a.landmark ? {} : { landmark: 1 }) } }, { returnDocument: "after" }).lean()) as unknown as Lean | null;
    if (!doc) return { ok: false, error: "Address not found." };
  } else {
    if ((await Address.countDocuments({ userId, deletedAt: null })) >= MAX_ADDRESSES) return { ok: false, error: `You can save up to ${MAX_ADDRESSES} addresses. Delete one first.` };
    doc = (await Address.create({ userId, ...fields })).toObject() as unknown as Lean;
  }
  const u = (await User.findById(userId, "defaultAddressId").lean()) as unknown as { defaultAddressId?: Types.ObjectId | null } | null;
  const first = !u?.defaultAddressId;
  if (makeDefault || first) await User.updateOne({ _id: userId }, { defaultAddressId: doc._id });
  return { ok: true, address: dto(doc, makeDefault || first ? String(doc._id) : u?.defaultAddressId ? String(u.defaultAddressId) : null) };
}

export async function deleteAddress(userId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  await db();
  const r = await Address.updateOne({ _id: id, userId, deletedAt: null }, { deletedAt: new Date() }); // soft delete: past orders keep their own snapshot anyway
  if (!r.matchedCount) return { ok: false, error: "Address not found." };
  const u = (await User.findById(userId, "defaultAddressId").lean()) as unknown as { defaultAddressId?: Types.ObjectId | null } | null;
  if (u?.defaultAddressId && String(u.defaultAddressId) === id) {
    const next = (await Address.findOne({ userId, deletedAt: null }, "_id").sort({ createdAt: -1 }).lean()) as unknown as { _id: Types.ObjectId } | null;
    await User.updateOne({ _id: userId }, { defaultAddressId: next?._id ?? null });
  }
  return { ok: true };
}

export async function setDefaultAddress(userId: string, id: string): Promise<{ ok: boolean; error?: string }> {
  await db();
  if (!(await Address.exists({ _id: id, userId, deletedAt: null }))) return { ok: false, error: "Address not found." };
  await User.updateOne({ _id: userId }, { defaultAddressId: id });
  return { ok: true };
}
