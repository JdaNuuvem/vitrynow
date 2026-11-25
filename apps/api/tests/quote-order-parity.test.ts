import { describe, expect, it } from "vitest";
import { applyFreeShipping } from "../src/lib/deliveryZones";
import { quoteOrder } from "../src/lib/quoteOrder";

// D5 (paridade): cópias LITERAIS das contas que viviam em storefront.ts, manualOrders.ts e tables.ts antes da extração.
// Mesmos dados -> mesmo resultado. Função pura: não precisa de banco.
type Coupon = { discountType: string; discountValue: number } | null;
function legacyStorefront(lines: number[], coupon: Coupon, delivery: boolean, baseFee: number, zoneFree: number | null, storeFree: number | null, tip: number) {
  const subtotalCents = lines.reduce((s, v) => s + v, 0);
  let discountCents = 0;
  if (coupon) {
    discountCents = coupon.discountType === "PERCENT" ? Math.round((subtotalCents * coupon.discountValue) / 100) : coupon.discountValue;
    discountCents = Math.min(discountCents, subtotalCents);
  }
  let deliveryFeeCents = 0;
  if (delivery) deliveryFeeCents = applyFreeShipping(baseFee, subtotalCents - discountCents, zoneFree, storeFree);
  return { subtotalCents, discountCents, deliveryFeeCents, totalCents: subtotalCents - discountCents + deliveryFeeCents + tip };
}
function legacyManual(lines: number[], coupon: Coupon, pct: number | undefined, delivery: boolean, fee: number, tip: number) {
  const subtotalCents = lines.reduce((s, v) => s + v, 0);
  const couponDiscountCents = coupon ? Math.min(coupon.discountType === "PERCENT" ? Math.round((subtotalCents * coupon.discountValue) / 100) : coupon.discountValue, subtotalCents) : 0;
  const manualDiscountCents = pct ? Math.round(((subtotalCents - couponDiscountCents) * pct) / 100) : 0;
  const discountCents = Math.min(couponDiscountCents + manualDiscountCents, subtotalCents);
  const deliveryFeeCents = delivery ? fee : 0;
  return { subtotalCents, discountCents, deliveryFeeCents, totalCents: subtotalCents - discountCents + deliveryFeeCents + tip };
}

const cases: Array<[string, number[], Coupon]> = [
  ["sem cupom", [1000, 2500], null],
  ["cupom % 10", [1000, 2500], { discountType: "PERCENT", discountValue: 10 }],
  ["cupom % arredonda", [333, 333, 334], { discountType: "PERCENT", discountValue: 15 }],
  ["cupom 100%", [1000], { discountType: "PERCENT", discountValue: 100 }],
  ["cupom fixo menor", [5000], { discountType: "FIXED", discountValue: 700 }],
  ["cupom fixo maior que subtotal", [500], { discountType: "FIXED", discountValue: 9000 }],
  ["subtotal zero", [], null],
  ["um item", [1], { discountType: "PERCENT", discountValue: 50 }],
];

describe("quoteOrder: paridade com as contas antigas", () => {
  for (const [name, lines, coupon] of cases) {
    for (const [tip, fee, zoneFree, storeFree] of [[0, 800, null, null], [250, 800, 1000, null], [0, 800, null, 2000], [100, 0, null, null]] as const) {
      it(`vitrine DELIVERY: ${name} gorjeta=${tip} taxa=${fee} zona=${zoneFree} loja=${storeFree}`, () => {
        const old = legacyStorefront(lines, coupon, true, fee, zoneFree, storeFree, tip);
        const q = quoteOrder({ lineTotalsCents: lines, coupon, delivery: { baseFeeCents: fee, zoneFreeFromCents: zoneFree, storeFreeFromCents: storeFree }, tipCents: tip });
        expect({ subtotalCents: q.subtotalCents, discountCents: q.discountCents, deliveryFeeCents: q.deliveryFeeCents, totalCents: q.totalCents }).toEqual(old);
      });
    }
    it(`vitrine retirada: ${name}`, () => {
      const old = legacyStorefront(lines, coupon, false, 800, null, null, 0);
      const q = quoteOrder({ lineTotalsCents: lines, coupon });
      expect(q.totalCents).toBe(old.totalCents);
      expect(q.deliveryFeeCents).toBe(0);
    });
    for (const pct of [undefined, 5, 33, 100]) {
      it(`manual: ${name} desconto=${pct}`, () => {
        const old = legacyManual(lines, coupon, pct, true, 700, 150);
        const q = quoteOrder({ lineTotalsCents: lines, coupon, manualDiscountPercent: pct, delivery: { baseFeeCents: 700 }, tipCents: 150 });
        expect({ subtotalCents: q.subtotalCents, discountCents: q.discountCents, deliveryFeeCents: q.deliveryFeeCents, totalCents: q.totalCents }).toEqual(old);
      });
    }
    it(`mesa: total = subtotal (${name})`, () => {
      expect(quoteOrder({ lineTotalsCents: lines }).totalCents).toBe(lines.reduce((s, v) => s + v, 0));
    });
  }

  it("aleatório (2000 casos, semente fixa): vitrine e manual", () => {
    let s = 12345;
    const rnd = (n: number) => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s % n);
    for (let i = 0; i < 2000; i++) {
      const lines = Array.from({ length: rnd(5) }, () => rnd(10000));
      const coupon: Coupon = rnd(3) === 0 ? null : { discountType: rnd(2) ? "PERCENT" : "FIXED", discountValue: rnd(2) ? rnd(101) : rnd(5000) };
      const tip = rnd(500);
      const fee = rnd(2000);
      const zf = rnd(2) ? null : rnd(8000);
      const sf = rnd(2) ? null : rnd(8000);
      const a = legacyStorefront(lines, coupon, true, fee, zf, sf, tip);
      const qa = quoteOrder({ lineTotalsCents: lines, coupon, delivery: { baseFeeCents: fee, zoneFreeFromCents: zf, storeFreeFromCents: sf }, tipCents: tip });
      expect(qa.totalCents).toBe(a.totalCents);
      expect(qa.discountCents).toBe(a.discountCents);
      const pct = rnd(2) ? undefined : rnd(101);
      const m = legacyManual(lines, coupon, pct, true, fee, tip);
      const qm = quoteOrder({ lineTotalsCents: lines, coupon, manualDiscountPercent: pct, delivery: { baseFeeCents: fee }, tipCents: tip });
      expect(qm.totalCents).toBe(m.totalCents);
      expect(qm.discountCents).toBe(m.discountCents);
    }
  });
});