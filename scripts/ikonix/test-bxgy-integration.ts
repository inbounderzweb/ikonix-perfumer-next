// Integration test of variant-level Buy X Get Y against the DB in .env: pricing engine, stock, redemption caps, cancel/refund paths.
// Creates its own tagged promotion/orders on the ZZ Test Perfume product and removes them afterwards. It also resets that product's inventory.
// Run: NODE_OPTIONS=--conditions=react-server npx tsx scripts/ikonix/test-bxgy-integration.ts
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { connect, disconnect } from "./_env";
import { Inventory, InventoryMovement, Order, Payment, Product, Promotion, PromotionRedemption } from "../../src/server/models";
import { priceCart } from "../../src/server/commerce/pricing";
import { cancelOrder, markOrderPaid, reserveStock } from "../../src/server/commerce/orders";
import { claimOffers, recordRedemptions } from "../../src/server/commerce/offers";

const TAG = "ZZTEST-BXGY";
let n = 0;
const ok = (m: string) => console.log("  ✓", m);

async function main() {
  await connect();
  const prod = (await Product.findOne({ slug: "zz-test-perfume" }).lean()) as unknown as { _id: Types.ObjectId; variants: { _id: Types.ObjectId; sku: string; salePrice: number; regularPrice: number }[] } | null;
  assert(prod, "create the ZZ Test Perfume product first");
  const v = prod.variants[0];
  const vid = String(v._id);
  const promoIds: Types.ObjectId[] = [];
  const orderIds: Types.ObjectId[] = [];
  const inv = async () => (await Inventory.findOne({ variantId: v._id }).lean()) as unknown as { onHand: number; reserved: number };
  const mkPromo = async (extra: Record<string, unknown> = {}, rule = { buy: 4, free: 1 }) => {
    const p = await Promotion.create({ name: `${TAG} ${++n}`, trigger: "AUTOMATIC", type: "BUY_X_GET_Y", scope: "TARGETS", targets: [{ kind: "VARIANT", refId: v._id }], buyQuantity: rule.buy, getQuantity: rule.free, status: "ACTIVE", variantRules: [{ productId: prod._id, variantId: v._id, ...rule }], ...extra } as never);
    promoIds.push(p._id as Types.ObjectId);
    return p._id as Types.ObjectId;
  };
  try {
    await Inventory.updateOne({ variantId: v._id }, { tracked: true, onHand: 20, reserved: 0 });

    // 1. Engine: server splits the cart quantity; browser input is only (variantId, qty).
    let pid = await mkPromo();
    let r = await priceCart([{ variantId: vid, qty: 5 }]);
    assert(r.ok); assert.equal(r.items[0].quantity, 4); assert.equal(r.items[0].freeQuantity, 1); assert.equal(r.items[0].lineTotal, 4 * v.salePrice); assert.equal(r.grandTotal, 4 * v.salePrice);
    assert.equal(r.items[0].offer?.offerId, String(pid)); assert.equal(r.items[0].offer?.savedAmount, v.salePrice);
    ok("5 units at Buy 4 Get 1 → 4 paid + 1 free, payable = 4 × sale price");
    r = await priceCart([{ variantId: vid, qty: 4 }]); assert(r.ok); assert.equal(r.items[0].freeQuantity, 0); ok("below threshold → no free units");
    r = await priceCart([{ variantId: vid, qty: 10 }]); assert(r.ok); assert.equal(r.items[0].freeQuantity, 2); assert.equal(r.items[0].quantity, 8); ok("multiple cycles");

    // 2. Pricing basis never changes the payable amount.
    await Promotion.updateOne({ _id: pid }, { pricingBasis: "MRP" });
    r = await priceCart([{ variantId: vid, qty: 5 }]); assert(r.ok); assert.equal(r.items[0].unitSalePrice, v.regularPrice); assert.equal(r.grandTotal, 4 * v.regularPrice); assert.equal(r.items[0].offer?.savedAmount, v.regularPrice); r = await priceCart([{ variantId: vid, qty: 4 }]); assert(r.ok); assert.equal(r.grandTotal, 4 * v.salePrice); ok("MRP basis: paid units cost MRP while the offer applies, selling price below the threshold");

    // 3. Lifecycle: disabled, expired, scheduled, min quantity.
    await Promotion.updateOne({ _id: pid }, { status: "INACTIVE" }); r = await priceCart([{ variantId: vid, qty: 5 }]); assert(r.ok && r.items[0].freeQuantity === 0); ok("disabled offer ignored");
    await Promotion.updateOne({ _id: pid }, { status: "ACTIVE", endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 86400000) }); r = await priceCart([{ variantId: vid, qty: 5 }]); assert(r.ok && r.items[0].freeQuantity === 0); ok("expired offer ignored (cart re-priced at checkout)");
    await Promotion.updateOne({ _id: pid }, { startsAt: new Date(Date.now() + 86400000), $unset: { endsAt: 1 } }); r = await priceCart([{ variantId: vid, qty: 5 }]); assert(r.ok && r.items[0].freeQuantity === 0); ok("scheduled offer not yet live");
    await Promotion.updateOne({ _id: pid }, { $unset: { startsAt: 1 }, minQuantity: 8 }); r = await priceCart([{ variantId: vid, qty: 5 }]); assert(r.ok && r.items[0].freeQuantity === 0); r = await priceCart([{ variantId: vid, qty: 10 }]); assert(r.ok && r.items[0].freeQuantity === 2); ok("minimum purchase quantity");
    await Promotion.updateOne({ _id: pid }, { $unset: { minQuantity: 1 } });

    // 4. Conflict: two offers on one variant → deterministic winner (better ratio when priority ties).
    const pid2 = await mkPromo({}, { buy: 2, free: 1 });
    r = await priceCart([{ variantId: vid, qty: 6 }]); assert(r.ok); assert.equal(r.items[0].offer?.offerId, String(pid2)); assert.equal(r.items[0].freeQuantity, 2); ok("two offers → best free ratio wins, never stacked");
    await Promotion.updateOne({ _id: pid2 }, { status: "INACTIVE" });

    // 5. Stock: reserve = paid + free; paid → sale; cancel after capture → full return; no double deduction.
    r = await priceCart([{ variantId: vid, qty: 5 }]); assert(r.ok);
    const stock = await reserveStock(r.items); assert(stock.ok);
    assert.equal((await inv()).reserved, 5); ok("reservation holds 5 units (4 paid + 1 free)");
    const claim = await claimOffers([String(pid)]); assert(claim.ok);
    const num = `IKX-991231-${95000 + n}`;
    const o = await Order.create({ orderNumber: num, status: "PENDING", paymentStatus: "CREATED", items: r.items.map(({ tracked, ...i }) => i), subtotal: r.subtotal, grandTotal: r.grandTotal,
      pricingSnapshot: { stockState: "RESERVED", reserved: stock.reserved }, contact: { name: TAG, phone: "+919999999999" }, shippingAddress: { fullName: TAG }, billingAddress: { fullName: TAG }, shippingMethodName: "test", idempotencyKey: `${TAG}-${Date.now()}`, reservationExpiresAt: new Date(Date.now() + 600000) } as never);
    orderIds.push(o._id as Types.ObjectId);
    await Payment.create({ orderId: o._id, providerOrderId: `order_${TAG.replace(/\W/g, "")}`, amount: r.grandTotal });
    await recordRedemptions(o._id as Types.ObjectId, null, r.items);
    const saved = (await Order.findById(o._id).lean()) as unknown as { items: { quantity: number; freeQuantity: number; offer: { offerId: string; buy: number; free: number } }[] };
    assert.equal(saved.items[0].freeQuantity, 1); assert.equal(saved.items[0].offer.buy, 4); ok("order stores paid/free quantities and the offer snapshot");
    assert.equal(await markOrderPaid(o._id, { providerPaymentId: "pay_ZZBXGY1" }), "confirmed");
    assert.equal(await markOrderPaid(o._id, { providerPaymentId: "pay_ZZBXGY1" }), "already");
    let i = await inv(); assert.equal(i.onHand, 15); assert.equal(i.reserved, 0); ok("payment consumes 5 units exactly once (duplicate verification is a no-op)");
    assert.equal(await cancelOrder(o._id, "test", { type: "ADMIN" }), true);
    assert.equal(await cancelOrder(o._id, "test", { type: "ADMIN" }), false);
    i = await inv(); assert.equal(i.onHand, 20); ok("cancel after capture returns all 5 units, once");
    const red = await PromotionRedemption.countDocuments({ orderId: o._id }); assert.equal(red, 0);
    assert.equal(((await Promotion.findById(pid).lean()) as unknown as { usageCount: number }).usageCount, 0); ok("cancel releases the offer redemption");

    // 6. Redemption caps.
    const cap = await mkPromo({ usageLimitTotal: 1 });
    await Promotion.updateOne({ _id: pid }, { status: "INACTIVE" });
    const [a, b] = await Promise.all([claimOffers([String(cap)]), claimOffers([String(cap)])]);
    assert.equal([a, b].filter((x) => x.ok).length, 1); ok("concurrent claims of the last redemption: exactly one wins");
    r = await priceCart([{ variantId: vid, qty: 5 }]); assert(r.ok && r.items[0].freeQuantity === 0); ok("exhausted offer stops applying");

    // 7. Concurrent purchases of the last stock.
    await Inventory.updateOne({ variantId: v._id }, { onHand: 5, reserved: 0 });
    await Promotion.updateOne({ _id: cap }, { status: "INACTIVE" }); await Promotion.updateOne({ _id: pid }, { status: "ACTIVE" });
    const priced = await priceCart([{ variantId: vid, qty: 5 }]); assert(priced.ok);
    const both = await Promise.all([reserveStock(priced.items), reserveStock(priced.items)]);
    assert.equal(both.filter((x) => x.ok).length, 1); assert.equal((await inv()).reserved, 5); ok("two buyers, 5 units (4+1 free): only one reservation succeeds, no oversell");
    const win = both.find((x) => x.ok); if (win && win.ok) for (const rr of win.reserved) await Inventory.updateOne({ variantId: rr.variantId }, { $inc: { reserved: -rr.qty } });
    r = await priceCart([{ variantId: vid, qty: 6 }]); assert(!r.ok); ok("cart quantity beyond stock is rejected before payment");
    console.log("\nAll BXGY integration checks passed");
  } finally {
    await PromotionRedemption.deleteMany({ promotionId: { $in: promoIds } });
    await Promotion.deleteMany({ _id: { $in: promoIds } });
    await Payment.deleteMany({ orderId: { $in: orderIds } });
    await InventoryMovement.deleteMany({ orderId: { $in: orderIds } });
    await Order.deleteMany({ _id: { $in: orderIds } });
    await Inventory.updateOne({ variantId: v._id }, { onHand: 20, reserved: 0 });
    await disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
