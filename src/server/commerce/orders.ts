import "server-only";
import { Types } from "mongoose";
import { db } from "@/server/db";
import { Counter, Inventory, InventoryMovement, Order, Payment, Product } from "@/server/models";
import type { PricedItem } from "./pricing";
import { releaseRedemptions } from "./offers";

export const RESERVATION_MS = 30 * 60 * 1000;
type Reserved = { variantId: string; productId: string; qty: number };
type OrderLean = { _id: Types.ObjectId; status: string; paymentStatus: string; items: { productId: Types.ObjectId; variantId: Types.ObjectId; quantity: number; freeQuantity: number }[]; pricingSnapshot?: { stockState?: StockState; reserved?: Reserved[] } };
type StockState = "RESERVED" | "CONSUMED" | "NONE";

export async function nextOrderNumber(): Promise<string> {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const c = (await Counter.findOneAndUpdate({ _id: `order:${ymd}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" }).lean()) as unknown as { seq: number };
  return `IKX-${ymd}-${String(c.seq).padStart(5, "0")}`;
}

// ── Stock ──────────────────────────────────────────────────────────────────
/** Atomically holds `qty` of each tracked line; all-or-nothing. Untracked sizes rely on the in/out flag only. */
export async function reserveStock(items: PricedItem[]): Promise<{ ok: true; reserved: Reserved[] } | { ok: false; error: string }> {
  const done: Reserved[] = [];
  for (const it of items) {
    if (!it.tracked) continue;
    const units = it.quantity + it.freeQuantity; // free units leave the shelf too
    const r = await Inventory.updateOne(
      { variantId: it.variantId, tracked: true, $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, units] } },
      { $inc: { reserved: units } },
    );
    if (!r.modifiedCount) {
      await releaseReserved(done);
      return { ok: false, error: `${it.productName} (${it.variantLabel}) just sold out. Please review your cart.` };
    }
    done.push({ variantId: String(it.variantId), productId: String(it.productId), qty: units });
  }
  return { ok: true, reserved: done };
}

async function releaseReserved(list: Reserved[]) {
  for (const r of list) {
    await Inventory.updateOne({ variantId: r.variantId, reserved: { $gte: r.qty } }, { $inc: { reserved: -r.qty } });
  }
}

async function movement(r: Reserved, type: "SALE" | "RETURN" | "RELEASE", orderId: Types.ObjectId, reason: string) {
  const inv = (await Inventory.findOne({ variantId: r.variantId }).lean()) as unknown as { onHand: number; reserved: number } | null;
  if (!inv) return;
  await InventoryMovement.create({
    variantId: r.variantId, productId: r.productId, type, orderId, reason,
    onHandDelta: type === "SALE" ? -r.qty : type === "RETURN" ? r.qty : 0, reservedDelta: type === "RELEASE" ? -r.qty : 0,
    onHandAfter: inv.onHand, reservedAfter: inv.reserved,
  });
}

/** Payment confirmed: turn held stock into a sale. Returns false if stock could not be secured (order stays cancelled). */
async function consumeStock(o: OrderLean): Promise<boolean> {
  const list = o.pricingSnapshot?.reserved ?? [];
  const held = o.pricingSnapshot?.stockState === "RESERVED";
  const done: Reserved[] = [];
  for (const r of list) {
    const res = held
      ? await Inventory.updateOne({ variantId: r.variantId, reserved: { $gte: r.qty }, onHand: { $gte: r.qty } }, { $inc: { onHand: -r.qty, reserved: -r.qty } })
      : await Inventory.updateOne({ variantId: r.variantId, $expr: { $gte: [{ $subtract: ["$onHand", "$reserved"] }, r.qty] } }, { $inc: { onHand: -r.qty } });
    if (!res.modifiedCount) {
      for (const d of done) await Inventory.updateOne({ variantId: d.variantId }, { $inc: { onHand: d.qty } }); // undo partial
      return false;
    }
    done.push(r);
  }
  for (const r of done) await movement(r, "SALE", o._id, "Order paid");
  return true;
}

// ── Payment confirmation (idempotent; called by browser verify AND webhook) ─
export async function markOrderPaid(orderId: Types.ObjectId | string, payment: { providerPaymentId: string; method?: string; methodDetail?: string; fromWebhook?: boolean }): Promise<"confirmed" | "already" | "needs_refund"> {
  await db();
  // 1. Claim the order atomically. Exactly one concurrent caller (browser verify vs webhook) gets the prior document;
  //    everyone else sees "already". Stock is only touched by the winner, so it can never be consumed twice.
  const prior = (await Order.findOneAndUpdate(
    { _id: orderId, paymentStatus: { $ne: "CAPTURED" } },
    { $set: { paymentStatus: "CAPTURED" } },
    { returnDocument: "before", projection: "status paymentStatus items pricingSnapshot" },
  ).lean()) as unknown as OrderLean | null;
  if (!prior) {
    if (!(await Order.exists({ _id: orderId }))) throw new Error("order not found");
    return "already";
  }

  // 2. Turn the held stock into a sale (or re-secure it if the hold had already lapsed).
  const wasCancelled = prior.status === "CANCELLED";
  const hasStock = (prior.pricingSnapshot?.reserved?.length ?? 0) > 0;
  const stockOk = hasStock ? await consumeStock(prior) : true;
  const status = !wasCancelled || stockOk ? "CONFIRMED" : "CANCELLED";
  const note = !stockOk ? "Payment received after the stock hold expired and stock is gone: refund required." : wasCancelled ? "Payment received after expiry; stock re-secured." : "Payment captured.";

  // 3. Record the outcome.
  await Order.updateOne(
    { _id: prior._id },
    {
      $set: { status, ...(status === "CONFIRMED" ? { confirmedAt: new Date() } : {}), "pricingSnapshot.stockState": hasStock && stockOk ? "CONSUMED" : "NONE" },
      $unset: { reservationExpiresAt: 1 },
      $push: { statusHistory: { from: prior.status, to: status, note, actorType: payment.fromWebhook ? "WEBHOOK" : "SYSTEM" } },
    },
  );
  await Payment.updateOne({ orderId: prior._id }, { providerPaymentId: payment.providerPaymentId, status: "CAPTURED", method: payment.method, methodDetail: payment.methodDetail, capturedAt: new Date(), signatureVerifiedAt: new Date() });
  if (status === "CONFIRMED") for (const it of prior.items) await Product.updateOne({ _id: it.productId }, { $inc: { soldCount: it.quantity + it.freeQuantity } });
  return status === "CONFIRMED" ? "confirmed" : "needs_refund";
}

/** Cancels an order and gives stock back. Safe to call twice. Does NOT refund money (admin uses the refund action). */
export async function cancelOrder(orderId: Types.ObjectId | string, reason: string, actor: { type: "SYSTEM" | "ADMIN" | "CUSTOMER"; userId?: string }) {
  await db();
  const o = (await Order.findById(orderId, "status paymentStatus items pricingSnapshot").lean()) as unknown as OrderLean | null;
  if (!o || o.status === "CANCELLED") return false;
  const flipped = await Order.findOneAndUpdate(
    { _id: o._id, status: { $ne: "CANCELLED" } },
    { $set: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason, "pricingSnapshot.stockState": "NONE" }, $unset: { reservationExpiresAt: 1 }, $push: { statusHistory: { from: o.status, to: "CANCELLED", note: reason, actorType: actor.type, actorUserId: actor.userId ?? null } } },
  ).lean();
  if (!flipped) return false;
  await releaseRedemptions(o._id); // the order no longer counts against the offer's caps
  const list = o.pricingSnapshot?.reserved ?? [];
  const state = o.pricingSnapshot?.stockState;
  for (const r of list) {
    if (state === "RESERVED") { await releaseReserved([r]); await movement(r, "RELEASE", o._id, reason); }
    else if (state === "CONSUMED") { await Inventory.updateOne({ variantId: r.variantId }, { $inc: { onHand: r.qty } }); await movement(r, "RETURN", o._id, reason); }
  }
  if (o.paymentStatus === "CAPTURED") for (const it of o.items) await Product.updateOne({ _id: it.productId, soldCount: { $gte: it.quantity + it.freeQuantity } }, { $inc: { soldCount: -(it.quantity + it.freeQuantity) } });
  return true;
}

/** Cancels unpaid orders whose stock hold has lapsed. Run opportunistically (checkout, admin orders list). */
export async function expirePendingOrders(limit = 25): Promise<number> {
  await db();
  const stale = (await Order.find({ status: "PENDING", paymentStatus: { $ne: "CAPTURED" }, reservationExpiresAt: { $lt: new Date() } }, "_id").limit(limit).lean()) as unknown as { _id: Types.ObjectId }[];
  let n = 0;
  for (const s of stale) if (await cancelOrder(s._id, "Payment not completed in time", { type: "SYSTEM" })) n++;
  return n;
}
