"use client";

import { useState } from "react";
import type { DiscountType, NewCouponInput } from "@/core/domain/coupons";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { emptyCouponDraft, toNewCouponInput, type CouponDraft } from "../couponForm";

export function NewCouponForm({ onCreate }: { onCreate: (input: NewCouponInput) => Promise<string | null> }) {
  const [draft, setDraft] = useState<CouponDraft>(emptyCouponDraft);
  const [error, setError] = useState<string | null>(null);
  const patch = (changes: Partial<CouponDraft>) => setDraft((prev) => ({ ...prev, ...changes }));

  async function submit() {
    if (!draft.code.trim()) return;
    setError(null);
    const failure = await onCreate(toNewCouponInput(draft));
    if (failure) return setError(failure);
    setDraft(emptyCouponDraft());
  }

  return (
    <div className="cupons-new">
      <h2>Novo cupom</h2>
      <div className="cupons-new__row">
        <input
          className="cupons-new__code"
          placeholder="CÓDIGO"
          value={draft.code}
          onChange={(event) => patch({ code: event.target.value })}
        />
        <select value={draft.discountType} onChange={(event) => patch({ discountType: event.target.value as DiscountType })}>
          <option value="PERCENT">% desconto</option>
          <option value="FIXED">R$ desconto</option>
        </select>
        <div className="cupons-new__value">
          {draft.discountType === "PERCENT" ? (
            <input placeholder="10" value={draft.percentValue} onChange={(event) => patch({ percentValue: event.target.value })} />
          ) : (
            <MoneyInput name="coupon-discount" value={draft.fixedValue} onChange={(fixedValue) => patch({ fixedValue })} />
          )}
        </div>
      </div>
      <div className="cupons-new__row">
        <input placeholder="Usos máximos (opcional)" value={draft.maxUses} onChange={(event) => patch({ maxUses: event.target.value })} />
        <div className="cupons-new__min">
          <MoneyInput name="coupon-min-order" value={draft.minOrder} onChange={(minOrder) => patch({ minOrder })} />
        </div>
      </div>
      <span className="cupons-new__hint">Pedido mínimo em R$ (opcional) — deixe em branco para sem mínimo.</span>
      {error && <p className="cupons__error">{error}</p>}
      <button type="button" className="cupons__btn cupons__btn--primary" onClick={submit}>
        Criar cupom
      </button>
    </div>
  );
}
