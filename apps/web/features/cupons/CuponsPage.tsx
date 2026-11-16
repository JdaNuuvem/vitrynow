"use client";

import { CouponRow } from "./components/CouponRow";
import { NewCouponForm } from "./components/NewCouponForm";
import { useCupons } from "./hooks/useCupons";
import "./cupons.css";

export function CuponsPage() {
  const { coupons, create, setActive, remove } = useCupons();

  async function alertOnFailure(action: Promise<string | null>) {
    const failure = await action;
    if (failure) alert(failure);
  }

  return (
    <main className="cupons">
      <h1>Cupons</h1>

      <NewCouponForm onCreate={create} />

      <div className="cupons__list">
        {coupons.map((coupon) => (
          <CouponRow
            key={coupon.id}
            coupon={coupon}
            onSetActive={(c, active) => alertOnFailure(setActive(c, active))}
            onDelete={(c) => alertOnFailure(remove(c))}
          />
        ))}
        {coupons.length === 0 && <p className="cupons__empty">Nenhum cupom ainda.</p>}
      </div>
    </main>
  );
}
