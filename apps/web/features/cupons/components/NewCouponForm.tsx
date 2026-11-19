"use client";

import { useId, useRef, useState } from "react";
import type { Coupon, DiscountType, NewCouponInput } from "@/core/domain/coupons";
import { Button, StateMessage } from "@/shared/design/components";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { Modal } from "@/shared/ui/Modal";
import { couponDraft, toNewCouponInput, type CouponDraft } from "../couponForm";

export function NewCouponForm({ onCreate, initial, restricted = false, onClose }: {
  onCreate: (input: NewCouponInput) => Promise<string | null>;
  initial?: Coupon;
  restricted?: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const original = couponDraft(initial);
  const [draft, setDraft] = useState<CouponDraft>(original);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const patch = (changes: Partial<CouponDraft>) => setDraft((previous) => ({ ...previous, ...changes }));

  async function submit() {
    if (running.current || !draft.code.trim()) return;
    const input = toNewCouponInput(draft);
    if (!input.discountValue) return setError("Informe um desconto maior que zero.");
    if (restricted && !input.maxUses) return setError("Informe um limite de usos para criar ou editar o cupom.");
    if (initial && original.expiresAt === draft.expiresAt) delete input.expiresAt;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const failure = await onCreate(input);
      if (failure) setError(failure);
      else onClose();
    } catch {
      setError("Não foi possível salvar o cupom. Confira sua conexão e tente de novo.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => { if (!running.current) onClose(); }} labelledBy={titleId} width={700} sheetOnMobile>
    <form className="cupons-new" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id={titleId}>{initial ? `Editar ${initial.code}` : "Novo cupom"}</h2>
      <fieldset disabled={busy}>
        <div className="cupons-new__row">
          <label>Código<input className="cupons-new__code" required minLength={3} maxLength={20} placeholder="BOASVINDAS"
            value={draft.code} onChange={(event) => patch({ code: event.target.value.toUpperCase() })} /></label>
          <label>Tipo de desconto<select value={draft.discountType} onChange={(event) => patch({ discountType: event.target.value as DiscountType })}>
            <option value="PERCENT">Percentual</option><option value="FIXED">Valor fixo</option>
          </select></label>
          <label>{draft.discountType === "PERCENT" ? "Desconto (%)" : "Desconto em reais"}
            {draft.discountType === "PERCENT" ? (
              <input type="number" required min={1} max={restricted ? 50 : 100} value={draft.percentValue} onChange={(event) => patch({ percentValue: event.target.value })} />
            ) : (
              <MoneyInput name="coupon-discount" value={draft.fixedValue} onChange={(fixedValue) => patch({ fixedValue })} />
            )}
          </label>
        </div>
        <div className="cupons-new__row">
          <label>{restricted ? "Limite de usos" : "Limite de usos (opcional)"}<input type="number" min={1} max={restricted ? 500 : undefined}
            required={restricted} value={draft.maxUses} onChange={(event) => patch({ maxUses: event.target.value })} /></label>
          <label>Pedido mínimo (opcional)
            <MoneyInput name="coupon-min-order" value={draft.minOrder} onChange={(minOrder) => patch({ minOrder })} />
          </label>
          <label>Validade (opcional)<input type="date" value={draft.expiresAt} onChange={(event) => patch({ expiresAt: event.target.value })} /></label>
        </div>
        {restricted && <p className="cupons-new__hint">Funcionários podem definir até 50% ou R$ 50,00 de desconto e até 500 usos.</p>}
        {initial && <p className="cupons-new__hint">Ao deixar um campo opcional em branco, o valor anterior é mantido. Digite 0 para retirar o pedido mínimo.</p>}
      </fieldset>
      {error && <StateMessage title="Cupom não salvo" tone="danger">{error}</StateMessage>}
      <div className="cupons-new__actions">
        <Button disabled={busy} onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary" busy={busy}>{initial ? "Salvar alterações" : "Criar cupom"}</Button>
      </div>
    </form>
    </Modal>
  );
}
