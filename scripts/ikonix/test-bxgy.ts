// Unit tests for the Buy X Get Y calculation (pure, no database).
// Run: npx tsx scripts/ikonix/test-bxgy.ts
import assert from "node:assert/strict";
import { bxgyPool, bxgyPrice, bxgyQuantities, pickOffer, offerLabel, isValidRule } from "../../src/lib/bxgy";

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log("  ✓", name); };

t("Buy 4 Get 1: quantity table (spec formula)", () => {
  const rule = { buy: 4, free: 1 };
  // qty → [free, paid]. floor(9/5)=1, so 9 → 1 free (the table row in the brief that says 2 contradicts its own formula).
  const cases: [number, number, number][] = [[1, 0, 1], [3, 0, 3], [4, 0, 4], [5, 1, 4], [8, 1, 7], [9, 1, 8], [10, 2, 8], [15, 3, 12]];
  for (const [q, free, paid] of cases) { const r = bxgyQuantities(q, rule); assert.deepEqual([r.free, r.paid], [free, paid], `qty ${q}`); assert.equal(r.free + r.paid, q); }
});
t("worked example: 5 × ₹569 at Buy 4 Get 1 → pays ₹2,276", () => {
  const r = bxgyPrice(5, { buy: 4, free: 1 }, { sale: 56900, mrp: 59900 });
  assert.equal(r.paid, 4); assert.equal(r.free, 1); assert.equal(r.payable, 227600); assert.equal(r.savings, 56900);
});
t("pricing basis MRP: paid units cost MRP only while the offer applies; below the threshold the selling price is charged", () => {
  const price = { sale: 56900, mrp: 59900 };
  const on = bxgyPrice(5, { buy: 4, free: 1 }, price, "MRP");
  assert.equal(on.unit, 59900); assert.equal(on.payable, 4 * 59900); assert.equal(on.savings, 59900);
  const off = bxgyPrice(4, { buy: 4, free: 1 }, price, "MRP");
  assert.equal(off.unit, 56900); assert.equal(off.payable, 4 * 56900); assert.equal(off.free, 0);
  const sell = bxgyPrice(5, { buy: 4, free: 1 }, price, "SELLING");
  assert.equal(sell.unit, 56900); assert.equal(sell.payable, 4 * 56900);
});
t("MRP basis never undervalues if MRP < sale (bad data)", () => {
  const r = bxgyPrice(5, { buy: 4, free: 1 }, { sale: 500, mrp: 400 }, "MRP"); assert.equal(r.savings, 500); assert.equal(r.unit, 500);
});
t("each variant is isolated (100ml B2G1 vs 50ml B4G2)", () => {
  assert.equal(bxgyQuantities(3, { buy: 2, free: 1 }).free, 1);
  assert.equal(bxgyQuantities(6, { buy: 4, free: 2 }).free, 2);
  assert.equal(bxgyQuantities(5, { buy: 4, free: 2 }).free, 0); // 100ml's units never pool into 50ml
});
t("larger groups: B3G1 (200ml)", () => { assert.equal(bxgyQuantities(7, { buy: 3, free: 1 }).free, 1); assert.equal(bxgyQuantities(8, { buy: 3, free: 1 }).free, 2); });
t("minimum purchase quantity gates the offer", () => {
  assert.equal(bxgyQuantities(5, { buy: 4, free: 1 }, 6).free, 0);
  assert.equal(bxgyQuantities(10, { buy: 4, free: 1 }, 6).free, 2);
});
t("quantity drops below threshold → free units disappear automatically", () => {
  assert.equal(bxgyQuantities(5, { buy: 4, free: 1 }).free, 1);
  assert.equal(bxgyQuantities(4, { buy: 4, free: 1 }).free, 0);
});
t("nudge appears exactly one unit before the next free unit", () => {
  assert.equal(bxgyQuantities(4, { buy: 4, free: 1 }).hintUnits, 1);
  assert.equal(bxgyQuantities(3, { buy: 4, free: 1 }).hintUnits, null);
  assert.equal(bxgyQuantities(5, { buy: 4, free: 1 }).hintUnits, null);
  assert.equal(bxgyQuantities(9, { buy: 4, free: 1 }).hintUnits, 1);
});
t("invalid rules and quantities are inert and never negative", () => {
  for (const r of [{ buy: 0, free: 1 }, { buy: 2, free: 0 }, { buy: 1.5, free: 1 }, { buy: -1, free: 1 }]) { assert.equal(isValidRule(r), false); assert.equal(bxgyQuantities(10, r).free, 0); }
  const z = bxgyQuantities(0, { buy: 1, free: 1 }); assert.deepEqual([z.paid, z.free], [0, 0]);
  assert.equal(bxgyQuantities(-3, { buy: 1, free: 1 }).paid, 0);
});
t("paid + free always equals the quantity; free never exceeds paid cycles (exhaustive 1..99, several rules)", () => {
  for (const [b, f] of [[1, 1], [2, 1], [4, 1], [4, 2], [3, 1], [10, 5]]) for (let q = 1; q <= 99; q++) {
    const r = bxgyQuantities(q, { buy: b, free: f });
    assert.equal(r.paid + r.free, q); assert.ok(r.free >= 0 && r.paid >= 0); assert.equal(r.free, Math.floor(q / (b + f)) * f);
  }
});
t("conflict rule is deterministic: priority → best ratio → oldest → id", () => {
  const base = { priority: 0, createdAt: 1000, minQuantity: 0 };
  const a = { ...base, id: "a", rule: { buy: 4, free: 1 } }, b = { ...base, id: "b", rule: { buy: 2, free: 1 } };
  assert.equal(pickOffer([a, b], 10)?.id, "b"); // better free ratio
  assert.equal(pickOffer([{ ...a, priority: 5 }, b], 10)?.id, "a"); // priority beats ratio
  const x = { ...base, id: "x", rule: { buy: 2, free: 1 }, createdAt: 2000 }, y = { ...base, id: "y", rule: { buy: 2, free: 1 }, createdAt: 1000 };
  assert.equal(pickOffer([x, y], 3)?.id, "y"); assert.equal(pickOffer([y, x], 3)?.id, "y"); // order of input is irrelevant
  const p = { ...y, id: "p" }, q = { ...y, id: "q" };
  assert.equal(pickOffer([q, p], 3)?.id, "p");
});
t("pickOffer skips offers whose minimum quantity isn't met", () => {
  const o = { id: "m", priority: 0, createdAt: 1, minQuantity: 6, rule: { buy: 2, free: 1 } };
  assert.equal(pickOffer([o], 5), null); assert.equal(pickOffer([o], 6)?.id, "m"); assert.equal(pickOffer([], 6), null);
});
t("label", () => assert.equal(offerLabel({ buy: 4, free: 1 }), "Buy 4 Get 1 Free"));
t("pooling: Oud ×3 (₹569) + Sauvage ×2 (₹474), 30 ml Buy 4 Get 1 → 1 free, taken from the cheapest line", () => {
  const r = bxgyPool([{ id: "oud", total: 3, sale: 56900, mrp: 59900 }, { id: "sauvage", total: 2, sale: 47400, mrp: 49900 }], { buy: 4, free: 1 });
  assert.equal(r.group.total, 5); assert.equal(r.group.free, 1);
  assert.deepEqual(r.lines.get("sauvage"), { paid: 1, free: 1, unit: 47400, payable: 47400, savings: 47400 });
  assert.deepEqual(r.lines.get("oud"), { paid: 3, free: 0, unit: 56900, payable: 3 * 56900, savings: 0 });
  const pay = [...r.lines.values()].reduce((a, x) => a + x.payable, 0); assert.equal(pay, 3 * 56900 + 47400);
});
t("pooling: free units spill into the next-cheapest line when the cheapest runs out", () => {
  const r = bxgyPool([{ id: "a", total: 1, sale: 100, mrp: 100 }, { id: "b", total: 9, sale: 200, mrp: 200 }], { buy: 3, free: 2 }); // 10 units → 2 cycles → 4 free
  assert.equal(r.group.free, 4); assert.deepEqual([r.lines.get("a")!.free, r.lines.get("b")!.free], [1, 3]);
  assert.equal(r.lines.get("a")!.payable, 0);
});
t("pooling: below threshold or below the pooled minimum gives nothing; paid+free always equals quantity", () => {
  assert.equal(bxgyPool([{ id: "a", total: 2, sale: 1, mrp: 1 }, { id: "b", total: 2, sale: 2, mrp: 2 }], { buy: 4, free: 1 }).group.free, 0);
  assert.equal(bxgyPool([{ id: "a", total: 3, sale: 1, mrp: 1 }, { id: "b", total: 3, sale: 2, mrp: 2 }], { buy: 4, free: 1 }, "SELLING", 7).group.free, 0);
  for (let x = 1; x <= 12; x++) for (let y = 1; y <= 12; y++) { const r = bxgyPool([{ id: "a", total: x, sale: 5, mrp: 6 }, { id: "b", total: y, sale: 3, mrp: 4 }], { buy: 4, free: 1 }); for (const [id, q] of [["a", x], ["b", y]] as const) assert.equal(r.lines.get(id)!.paid + r.lines.get(id)!.free, q); }
});
t("pooling is deterministic for equal prices (id order); MRP basis charges every paid unit in an earning pool at MRP", () => {
  const a = bxgyPool([{ id: "y", total: 3, sale: 100, mrp: 150 }, { id: "x", total: 2, sale: 100, mrp: 150 }], { buy: 4, free: 1 }, "MRP");
  assert.equal(a.lines.get("x")!.free, 1); assert.equal(a.lines.get("x")!.savings, 150); assert.equal(a.lines.get("x")!.unit, 150); assert.equal(a.lines.get("x")!.payable, 150); assert.equal(a.lines.get("y")!.unit, 150); assert.equal(a.lines.get("y")!.payable, 450);
});
t("mix & match: 5 different variants (1 each), Buy 4 Get 1 → only the lowest-priced one is free", () => {
  const prices = [131600, 80900, 56900, 47400, 154900];
  const r = bxgyPool(prices.map((sale, i) => ({ id: `v${i}`, total: 1, sale, mrp: sale + 2000 })), { buy: 4, free: 1 });
  assert.equal(r.group.free, 1);
  assert.equal(r.lines.get("v3")!.free, 1); assert.equal(r.lines.get("v3")!.payable, 0);
  assert.equal([...r.lines.values()].filter((x) => x.free).length, 1);
  assert.equal([...r.lines.values()].reduce((a, x) => a + x.payable, 0), prices.reduce((a, b) => a + b, 0) - 47400);
});
console.log(`\n${n} unit tests passed`);
