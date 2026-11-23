// Integration test of the payment + stock logic against the local DB. Creates and removes its own data.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/ikonix/test-payments.ts
// (the react-server condition makes the `server-only` guard a no-op outside Next.js)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Types } from "mongoose";
import { connect, disconnect } from "./_env";
import { Inventory, InventoryMovement, Order, Payment, Product } from "../../src/server/models";
import { cancelOrder, expirePendingOrders, markOrderPaid, reserveStock } from "../../src/server/commerce/orders";
import { verifyPaymentSignature, verifyWebhookSignature } from "../../src/server/commerce/razorpay";
import type { PricedItem } from "../../src/server/commerce/pricing";

const TAG = "ZZTEST-PAY";
let n = 0;
const results: string[] = [];
const ok = (m: string) => { results.push(m); console.log("  ✓", m); };

async function main() {
  await connect();
  const prod = (await Product.findOne({ slug: "zz-test-perfume" }).lean()) as unknown as { _id: Types.ObjectId; variants: { _id: Types.ObjectId; sku: string }[] } | null;
  assert(prod, "create the ZZ Test Perfume product first");
  const v = prod.variants[0];
  const item = (qty: number): PricedItem => ({ productId: prod._id, variantId: v._id, sku: v.sku, productName: "ZZ Test", variantLabel: "30 ml", unitRegularPrice: 100000, unitSalePrice: 80000, quantity: qty, freeQuantity: 0, lineDiscount: 0, lineTotal: 80000 * qty, taxAmount: 0, tracked: true });
  const inv = async () => (await Inventory.findOne({ variantId: v._id }).lean()) as unknown as { onHand: number; reserved: number };
  const sold = async () => ((await Product.findById(prod._id, "soldCount").lean()) as unknown as { soldCount: number }).soldCount;
  await Inventory.updateOne({ variantId: v._id }, { tracked: true, onHand: 5, reserved: 0 });

  async function makeOrder(qty: number, opts: { hold?: boolean; status?: string; expired?: boolean } = {}) {
    const stock = opts.hold === false ? { ok: true as const, reserved: [] } : await reserveStock([item(qty)]);
    assert(stock.ok);
    const num = `IKX-991231-${String(90000 + ++n)}`;
    const o = await Order.create({
      orderNumber: num, status: opts.status ?? "PENDING", paymentStatus: "CREATED", items: [{ ...item(qty) }], subtotal: 80000 * qty, grandTotal: 80000 * qty,
      pricingSnapshot: { stockState: stock.reserved.length ? "RESERVED" : "NONE", reserved: stock.reserved },
      contact: { name: TAG, phone: "+919999999999" }, shippingAddress: { fullName: TAG }, billingAddress: { fullName: TAG }, shippingMethodName: "test", idempotencyKey: `${TAG}-${Date.now()}-${n}`,
      reservationExpiresAt: new Date(Date.now() + (opts.expired ? -60_000 : 600_000)),
    } as never);
    await Payment.create({ orderId: o._id, providerOrderId: `order_${TAG.replace(/\W/g, "")}${n}`, amount: 80000 * qty });
    return o._id as Types.ObjectId;
  }

  console.log("Stock reservation");
  const s = await reserveStock([item(4)]); assert(s.ok); assert.equal((await inv()).reserved, 4); ok("reserve 4 of 5");
  const over = await reserveStock([item(2)]); assert(!over.ok); assert.equal((await inv()).reserved, 4); ok("reserving 2 more is refused (only 1 free), nothing leaked");
  await Inventory.updateOne({ variantId: v._id }, { reserved: 0 });
  const racers = await Promise.all(Array.from({ length: 8 }, () => reserveStock([item(1)])));
  assert.equal(racers.filter((r) => r.ok).length, 5); assert.equal((await inv()).reserved, 5); ok("8 concurrent buyers, 5 units: exactly 5 win (no oversell)");
  await Inventory.updateOne({ variantId: v._id }, { reserved: 0 });

  console.log("Payment confirmation");
  const soldBefore = await sold();
  let id = await makeOrder(2);
  const race = await Promise.all([markOrderPaid(id, { providerPaymentId: "pay_race1" }), markOrderPaid(id, { providerPaymentId: "pay_race1", fromWebhook: true })]);
  assert.equal(race.filter((r) => r === "confirmed").length, 1, JSON.stringify(race));
  let i = await inv(); assert.deepEqual([i.onHand, i.reserved], [3, 0]); assert.equal(await sold(), soldBefore + 2);
  const o1 = (await Order.findById(id).lean()) as unknown as { status: string; paymentStatus: string };
  assert.deepEqual([o1.status, o1.paymentStatus], ["CONFIRMED", "CAPTURED"]); ok("verify + webhook racing: confirmed exactly once, stock 5→3, soldCount +2");
  assert.equal(await markOrderPaid(id, { providerPaymentId: "pay_race1" }), "already"); ok("replayed payment event is a no-op");
  assert.equal(await InventoryMovement.countDocuments({ orderId: id, type: "SALE" }), 1); ok("exactly one SALE movement recorded");

  console.log("Cancellation");
  assert(await cancelOrder(id, "test", { type: "ADMIN" })); i = await inv(); assert.deepEqual([i.onHand, i.reserved], [5, 0]); assert.equal(await sold(), soldBefore); ok("cancelling a paid order restocks 2 and reverses soldCount");
  assert.equal(await cancelOrder(id, "again", { type: "ADMIN" }), false); assert.equal((await inv()).onHand, 5); ok("cancelling twice does not restock twice");

  console.log("Expiry & late payment");
  id = await makeOrder(3, { expired: true }); assert.equal((await inv()).reserved, 3);
  assert((await expirePendingOrders()) >= 1); i = await inv(); assert.equal(i.reserved, 0); ok("unpaid order past its hold is cancelled and stock released");
  assert.equal(await markOrderPaid(id, { providerPaymentId: "pay_late1" }), "confirmed"); i = await inv(); assert.deepEqual([i.onHand, i.reserved], [2, 0]); ok("late payment re-secures stock when available (5→2)");
  const id2 = await makeOrder(1, { hold: false, status: "CANCELLED" });
  await Order.updateOne({ _id: id2 }, { "pricingSnapshot.reserved": [{ variantId: String(v._id), productId: String(prod._id), qty: 4 }], "pricingSnapshot.stockState": "NONE" });
  assert.equal(await markOrderPaid(id2, { providerPaymentId: "pay_late2" }), "needs_refund"); assert.equal((await inv()).onHand, 2); ok("late payment with no stock left → flagged needs_refund, stock untouched");

  console.log("Signatures");
  const secret = process.env.RAZORPAY_KEY_SECRET!;
  const good = createHmac("sha256", secret).update("order_X|pay_Y").digest("hex");
  assert(verifyPaymentSignature("order_X", "pay_Y", good)); assert(!verifyPaymentSignature("order_X", "pay_Z", good)); assert(!verifyPaymentSignature("order_X", "pay_Y", good.slice(0, 63) + (good.endsWith("0") ? "1" : "0"))); assert(!verifyPaymentSignature("order_X", "pay_Y", "short")); ok("checkout signature: valid accepted; tampered id/signature and malformed rejected");
  process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test"; const body = '{"event":"payment.captured"}';
  const sig = createHmac("sha256", "whsec_test").update(body).digest("hex");
  assert(verifyWebhookSignature(body, sig)); assert(!verifyWebhookSignature(body + " ", sig)); assert(!verifyWebhookSignature(body, null)); ok("webhook signature: valid accepted; altered body / missing header rejected");
}

async function cleanup() {
  const ids = (await Order.find({ "contact.name": TAG }, "_id").lean()).map((o) => o._id);
  await Payment.deleteMany({ orderId: { $in: ids } });
  await InventoryMovement.deleteMany({ orderId: { $in: ids } });
  await Order.deleteMany({ _id: { $in: ids } });
  const prod = (await Product.findOne({ slug: "zz-test-perfume" }, "variants").lean()) as unknown as { variants: { _id: Types.ObjectId }[] } | null;
  if (prod) await Inventory.updateOne({ variantId: prod.variants[0]._id }, { tracked: false, onHand: 0, reserved: 0 });
  await Product.updateOne({ slug: "zz-test-perfume" }, { soldCount: 0 });
}
main()
  .then(() => console.log(`\nALL ${results.length} CHECKS PASSED`))
  .catch((e) => { console.error("\nFAILED:", e.message); process.exitCode = 1; })
  .finally(async () => { await cleanup().catch((e) => console.error("cleanup", e.message)); await disconnect(); });
