import { useState } from "react";
import type { StoreInfo } from "@/core/domain/storefront";
import { formatCents, maskMoneyInput } from "@/shared/format/money";
import {
  PAYMENT_OPTIONS,
  STORE_CLOSED_MESSAGE,
  TIP_OPTIONS_CENTS,
  checkoutTotals,
  validateChange,
  type CheckoutForm,
  type CheckoutTotals,
} from "../checkoutForm";

// Só coleta os dados do pedido e chama onSubmit — enviar pra API e tratar erro é com quem
// usa o componente (a página), não com a gaveta.
export function CheckoutDrawer({
  store,
  subtotalCents,
  closed,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  store: StoreInfo;
  subtotalCents: number;
  closed: boolean;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (form: CheckoutForm, totals: CheckoutTotals) => void;
}) {
  const [form, setForm] = useState<CheckoutForm>({
    deliveryType: store.deliveryEnabled ? "DELIVERY" : "BALCAO",
    customerName: "",
    customerPhone: "",
    address: "",
    couponCode: "",
    paymentMethod: "DINHEIRO",
    changeFor: "",
    tipCents: 0,
  });
  const update = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const totals = checkoutTotals({
    subtotalCents,
    deliveryType: form.deliveryType,
    deliveryFeeCents: store.deliveryFeeCents,
    tipCents: form.tipCents,
  });
  const changeError = validateChange(form, totals.totalCents);
  const blocked = closed || changeError !== null;

  const tabClass = (active: boolean) => `loja__tab${active ? " loja__tab--active" : ""}`;
  const tipClass = (active: boolean) => `loja__tip${active ? " loja__tip--active" : ""}`;

  return (
    <div className="loja__sheet" onClick={onClose}>
      <div className="loja__sheet-panel loja__sheet-panel--tall" onClick={(e) => e.stopPropagation()}>
        <div className="loja__sheet-head">
          <h2 className="loja__sheet-title">Finalizar pedido</h2>
          <button onClick={onClose} className="loja__sheet-close">
            fechar
          </button>
        </div>

        <div className="loja__form">
          {store.deliveryEnabled && store.pickupEnabled && (
            <div className="loja__tabs">
              <button onClick={() => update("deliveryType", "BALCAO")} className={tabClass(form.deliveryType === "BALCAO")}>
                Retirar no local
              </button>
              <button onClick={() => update("deliveryType", "DELIVERY")} className={tabClass(form.deliveryType === "DELIVERY")}>
                Entrega
              </button>
            </div>
          )}
          <input
            placeholder="Seu nome"
            value={form.customerName}
            onChange={(e) => update("customerName", e.target.value)}
            className="loja__field"
          />
          <input
            placeholder="Telefone"
            value={form.customerPhone}
            onChange={(e) => update("customerPhone", e.target.value)}
            className="loja__field"
          />
          {form.deliveryType === "DELIVERY" && (
            <input
              placeholder="Endereço de entrega"
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
              className="loja__field"
            />
          )}
          <input
            placeholder="Cupom de desconto (opcional)"
            value={form.couponCode}
            onChange={(e) => update("couponCode", e.target.value)}
            className="loja__field loja__field--upper"
          />
          <select
            value={form.paymentMethod}
            onChange={(e) => update("paymentMethod", e.target.value as CheckoutForm["paymentMethod"])}
            className="loja__field"
          >
            {PAYMENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {form.paymentMethod === "DINHEIRO" && (
            <div>
              <label className="loja__label" htmlFor="loja-troco">
                Troco para (opcional)
              </label>
              <div className="loja__money">
                <span>R$</span>
                <input
                  id="loja-troco"
                  inputMode="numeric"
                  placeholder="0,00"
                  value={form.changeFor}
                  onChange={(e) => update("changeFor", maskMoneyInput(e.target.value))}
                />
              </div>
              {changeError && <p className="loja__error">{changeError}</p>}
            </div>
          )}

          <div>
            <span className="loja__label">Gorjeta (opcional)</span>
            <div className="loja__tips">
              {TIP_OPTIONS_CENTS.map((cents) => (
                <button key={cents} onClick={() => update("tipCents", cents)} className={tipClass(form.tipCents === cents)}>
                  {cents === 0 ? "Sem gorjeta" : formatCents(cents)}
                </button>
              ))}
            </div>
          </div>

          <div className="loja__summary">
            <div className="loja__summary-row">
              <span>Subtotal</span>
              <span>{formatCents(totals.subtotalCents)}</span>
            </div>
            {totals.deliveryFeeCents > 0 && (
              <div className="loja__summary-row">
                <span>Taxa de entrega</span>
                <span>{formatCents(totals.deliveryFeeCents)}</span>
              </div>
            )}
            {totals.tipCents > 0 && (
              <div className="loja__summary-row">
                <span>Gorjeta</span>
                <span>{formatCents(totals.tipCents)}</span>
              </div>
            )}
            <div className="loja__summary-row loja__summary-row--total">
              <span>Total</span>
              <span>{formatCents(totals.totalCents)}</span>
            </div>
            {form.couponCode.trim() && <p className="loja__hint">O desconto do cupom é aplicado ao enviar o pedido.</p>}
          </div>

          {closed && <p className="loja__error">{STORE_CLOSED_MESSAGE}.</p>}
          {error && !closed && <p className="loja__error">{error}</p>}
          <button onClick={() => onSubmit(form, totals)} disabled={submitting || blocked} className="loja__cta">
            {submitting ? "Enviando..." : `Finalizar pedido · ${formatCents(totals.totalCents)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
