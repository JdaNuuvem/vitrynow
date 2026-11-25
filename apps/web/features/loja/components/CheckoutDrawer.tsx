import { useEffect, useRef, useState } from "react";
import { TurnstileWidget } from "./TurnstileWidget";
import type { PaymentMethod, StoreInfo } from "@/core/domain/storefront";
import { formatCents, maskMoneyInput } from "@/shared/format/money";
import { maskPhoneInput, PHONE_INPUT_PROPS } from "@/shared/format/phone";
import { Icon } from "@/shared/icons/Icon";
import type { StorefrontGateway } from "@/core/gateways/StorefrontGateway";
import { useDeliveryZones } from "../hooks/useDeliveryZones";
import {
  CHECKOUT_LIMITS,
  PAYMENT_GROUPS,
  STORE_CLOSED_MESSAGE,
  TIP_OPTIONS_CENTS,
  checkoutTotals,
  firstInvalidField,
  validateCheckout,
  type CheckoutErrors,
  type CheckoutField,
  type CheckoutForm,
  type CheckoutTotals,
} from "../checkoutForm";
import { Sheet } from "./Sheet";
import { applyFreeShipping } from "@meucardapio/shared-types/quote";
import { scheduleDays, scheduleLabel, scheduleTimes } from "../scheduleSlots";
import { safeTimeZone } from "@/shared/format/storeTime";

const FIELD_ID: Record<CheckoutField, string> = {
  customerName: "loja-nome",
  customerPhone: "loja-telefone",
  address: "loja-endereco",
  changeFor: "loja-troco",
};

// Só coleta os dados do pedido e chama onSubmit — enviar pra API e tratar erro é com quem
// usa o componente (a página), não com a gaveta. Spec 09 §10.2: rótulos visíveis, erros por
// campo com resumo no topo e foco no primeiro inválido, pagamento e entrega em radiogroup.
export function CheckoutDrawer({
  store,
  subtotalCents,
  closed,
  submitting,
  error,
  errorCode,
  errorDetails,
  gateway,
  pixAvailable = true,
  onClose,
  onSubmit,
}: {
  store: StoreInfo;
  subtotalCents: number;
  closed: boolean;
  submitting: boolean;
  error: string | null;
  errorCode?: string | null;
  errorDetails?: unknown;
  gateway?: StorefrontGateway;
  // PIX só deve aparecer com o Mercado Pago da loja conectado (B1/API-07). Até o backend
  // informar isso, a página mantém true (comportamento de hoje).
  pixAvailable?: boolean;
  onClose: () => void;
  onSubmit: (form: CheckoutForm, totals: CheckoutTotals, captchaToken?: string) => void;
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
  // API-40: "Agora" ou "Agendar" (só quando a loja aceita agendamento). Loja FECHADA agora, mas que agenda: só "Agendar".
  const canSchedule = store.scheduling === true;
  const timeZone = safeTimeZone(store.timezone);
  const [when, setWhen] = useState<"now" | "later">(closed && canSchedule ? "later" : "now");
  const [scheduleDay, setScheduleDay] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleError, setScheduleError] = useState(false);
  const later = canSchedule && (when === "later" || closed);
  const blocked = closed && !canSchedule; // fechada e sem agendamento: nada a fazer
  const now = new Date();
  const days = later ? scheduleDays(now, timeZone) : [];
  const day = scheduleDay || days.find((d) => scheduleTimes(d.value, now, timeZone).length > 0)?.value || "";
  const times = later && day ? scheduleTimes(day, now, timeZone) : [];
  const scheduledFor = later && times.some((t) => t.value === scheduleTime) ? scheduleTime : "";
  const [attempted, setAttempted] = useState(false);
  const [neighborhood, setNeighborhood] = useState("");
  const [requiresNeighborhood, setRequiresNeighborhood] = useState(false);
  const [rejectedPix, setRejectedPix] = useState(false);
  const [quote, setQuote] = useState<{ key: string; fee: number; total: number } | null>(null);
  const submittedKey = useRef("");
  const submittedCoupon = useRef("");
  const coupon = form.couponCode.trim();
  const delivery = form.deliveryType === "DELIVERY";
  const { config, loading: zonesLoading, failed: zonesFailed, retry: reloadZones } = useDeliveryZones(gateway, store.slug, store.deliveryEnabled);
  const zone = config?.zones.find((option) => option.id === neighborhood);
  const hasZoneChoice = Boolean(config?.zones.length || requiresNeighborhood);
  const outside = Boolean(config?.outsideMode === "DEFAULT_FEE" && neighborhood === "outside");
  const missingZone = delivery && hasZoneChoice && !zone && !outside;
  const pendingZone = delivery && (zonesLoading || zonesFailed || missingZone);
  const pixEnabled = pixAvailable && !rejectedPix;
  const missingPayment = form.paymentMethod === "PIX" && !pixEnabled;
  const pricingKey = JSON.stringify([form.deliveryType, neighborhood, subtotalCents, form.tipCents, coupon]);
  const activeQuote = quote?.key === pricingKey ? quote : null;
  // SSOT D5: frete grátis pela MESMA regra do servidor (limiar do bairro vence o da loja). Sem cupom aqui: com cupom o
  // servidor usa o subtotal líquido e, se der diferente, devolve o valor certo (409 DELIVERY_FEE_CHANGED).
  const baseFee = zone?.feeCents ?? config?.defaultFeeCents ?? store.deliveryFeeCents;
  const estimatedFee = applyFreeShipping(baseFee, subtotalCents, zone?.freeFromCents, config?.freeShippingFromCents);
  useEffect(() => {
    if (errorCode === "PIX_UNAVAILABLE") setRejectedPix(true);
    if (errorCode === "NEIGHBORHOOD_REQUIRED" || errorCode === "NEIGHBORHOOD_UNAVAILABLE" || errorCode === "NEIGHBORHOOD_NOT_FOUND") {
      setNeighborhood("");
      setRequiresNeighborhood(true);
      setQuote(null);
      reloadZones();
    }
    if (errorCode === "DELIVERY_FEE_CHANGED") {
      const data = errorDetails as { deliveryFeeCents?: number; totalCents?: number } | null;
      if (typeof data?.deliveryFeeCents === "number" && Number.isSafeInteger(data.deliveryFeeCents) && data.deliveryFeeCents >= 0 &&
          typeof data.totalCents === "number" && Number.isSafeInteger(data.totalCents) && data.totalCents >= 0) {
        setQuote({ key: submittedKey.current, fee: data.deliveryFeeCents, total: data.totalCents });
      } else {
        reloadZones();
      }
    }
  }, [errorCode, errorDetails, reloadZones]);
  const couponRejected = Boolean(error && /cupom/i.test(error) && submittedCoupon.current);
  const couponError = couponRejected && coupon === submittedCoupon.current && !blocked ? error : null;
  const update = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const estimatedTotals = checkoutTotals({
    subtotalCents,
    deliveryType: form.deliveryType,
    deliveryFeeCents: activeQuote?.fee ?? estimatedFee,
    tipCents: form.tipCents,
  });
  const totals = activeQuote ? { ...estimatedTotals, totalCents: activeQuote.total } : estimatedTotals;
  const quotedDiscount = activeQuote ? estimatedTotals.totalCents - activeQuote.total : 0;
  // Só mostra os erros depois da primeira tentativa de enviar (não grita com quem ainda digita).
  const errors: CheckoutErrors = attempted ? validateCheckout(form, totals.totalCents) : {};
  const errorCount = Object.keys(errors).length;

  // NG-08: `captchaToken` só existe depois que o cliente resolve a verificação pedida pela API (uso único).
  function submit(captchaToken?: string) {
    if (submitting || blocked || pendingZone || missingPayment || (!store.pickupEnabled && !store.deliveryEnabled)) return;
    if (later && !scheduledFor) {
      setScheduleError(true);
      document.getElementById("loja-agendar-hora")?.focus();
      return;
    }
    const found = validateCheckout(form, totals.totalCents);
    const first = firstInvalidField(found);
    if (first) {
      setAttempted(true);
      document.getElementById(FIELD_ID[first])?.focus();
      return;
    }
    submittedCoupon.current = coupon;
    submittedKey.current = pricingKey;
    onSubmit({
      ...form,
      ...(delivery ? { neighborhoodId: zone?.id, expectedDeliveryFeeCents: totals.deliveryFeeCents } : {}),
      ...(later && scheduledFor ? { scheduledFor } : { scheduledFor: undefined }),
    }, totals, captchaToken);
  }

  const fieldProps = (field: CheckoutField) => ({
    id: FIELD_ID[field],
    "aria-invalid": errors[field] ? (true as const) : undefined,
    "aria-describedby": errors[field] ? `${FIELD_ID[field]}-erro` : undefined,
  });
  const fieldError = (field: CheckoutField) =>
    errors[field] ? (
      <p id={`${FIELD_ID[field]}-erro`} className="loja__error-text">
        <span aria-hidden="true">✕ </span>
        {errors[field]}
      </p>
    ) : null;

  const showOptions = store.deliveryEnabled && store.pickupEnabled;
  const deliveryChoices: { value: CheckoutForm["deliveryType"]; label: string }[] = [
    { value: "BALCAO", label: "Retirar no local" },
    { value: "DELIVERY", label: "Entrega" },
  ];

  return (
    <Sheet title="Finalizar pedido" onClose={onClose} tall purchase>
      <form
        className="loja__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {errorCount > 0 && (
          <div role="alert" className="loja__error-summary">
            {errorCount === 1 ? "Corrija 1 campo para continuar." : `Corrija ${errorCount} campos para continuar.`}
          </div>
        )}
        {blocked && (
          <div role="alert" className="loja__error-summary">
            {STORE_CLOSED_MESSAGE}.
          </div>
        )}
        {canSchedule && (
          <fieldset className="loja__fieldset">
            <legend>Quando você quer receber?</legend>
            {closed && <p className="loja__hint">A loja está fechada agora, mas você pode agendar o seu pedido.</p>}
            {!closed && <div className="loja__choices" role="radiogroup" aria-label="Quando">
              <label><input type="radio" name="loja-quando" checked={when === "now"} onChange={() => setWhen("now")} /> Agora</label>
              <label><input type="radio" name="loja-quando" checked={when === "later"} onChange={() => setWhen("later")} /> Agendar</label>
            </div>}
            {later && <div className="loja__schedule">
              <label htmlFor="loja-agendar-dia">Dia
                <select id="loja-agendar-dia" value={day} onChange={(event) => { setScheduleDay(event.target.value); setScheduleTime(""); }}>
                  {days.map((d) => <option key={d.value} value={d.value} disabled={scheduleTimes(d.value, now, timeZone).length === 0}>{d.label}</option>)}
                </select>
              </label>
              <label htmlFor="loja-agendar-hora">Horário
                <select id="loja-agendar-hora" value={scheduledFor} aria-invalid={scheduleError && !scheduledFor ? true : undefined}
                  aria-describedby={scheduleError && !scheduledFor ? "loja-agendar-erro" : undefined}
                  onChange={(event) => { setScheduleTime(event.target.value); setScheduleError(false); }}>
                  <option value="">Escolha</option>
                  {times.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              {scheduleError && !scheduledFor && <p id="loja-agendar-erro" className="loja__error-text"><span aria-hidden="true">✕ </span>Escolha o horário do agendamento.</p>}
              <p className="loja__hint">Horários no fuso da loja. Se a loja não atender no horário escolhido, avisamos antes de enviar.</p>
            </div>}
          </fieldset>
        )}
        {error && !blocked && !couponRejected && (
          <div role="alert" className="loja__error-summary">
            <p>{error}</p>
            {errorCode === "CAPTCHA_REQUIRED" && !submitting && <TurnstileWidget onToken={(token) => submit(token)} />}
            {!errorCode && <button type="button" className="loja__empty-menu-link" onClick={() => submit()} disabled={submitting}>
              Tentar de novo
            </button>}
          </div>
        )}

        {showOptions && (
          <fieldset className="loja__fieldset">
            <legend className="loja__legend">Como você quer receber</legend>
            <div className="loja__choice-grid">
              {deliveryChoices.map((choice) => (
                <label
                  key={choice.value}
                  className={`loja__radio-card loja__radio-card--inline${form.deliveryType === choice.value ? " loja__radio-card--checked" : ""}`}
                >
                  <input
                    type="radio"
                    name="deliveryType"
                    value={choice.value}
                    checked={form.deliveryType === choice.value}
                    onChange={() => update("deliveryType", choice.value)}
                  />
                  {choice.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {delivery && (hasZoneChoice || zonesFailed || zonesLoading) && (
          <div className="loja__zone">
            <label className="loja__label" htmlFor="loja-bairro">Bairro da entrega</label>
            {zonesLoading ? <p role="status">Consultando bairros…</p> : zonesFailed ? (
              <div role="alert">
                <p>Não foi possível consultar a taxa de entrega.</p>
                <button type="button" className="loja__empty-menu-link" onClick={reloadZones}>Consultar novamente</button>
              </div>
            ) : (
              <>
                <select id="loja-bairro" className="loja__field" value={neighborhood} onChange={(event) => setNeighborhood(event.target.value)}>
                  <option value="">Selecione o bairro</option>
                  {config?.zones.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                  {config?.outsideMode === "DEFAULT_FEE" && <option value="outside">Outro bairro</option>}
                </select>
                {requiresNeighborhood && !config?.zones.length && config?.outsideMode !== "DEFAULT_FEE" && (
                  <p className="loja__hint">Nenhum bairro está disponível para entrega no momento.</p>
                )}
              </>
            )}
          </div>
        )}

        <div>
          <label className="loja__label" htmlFor={FIELD_ID.customerName}>
            Nome <span className="loja__required">(obrigatório)</span>
          </label>
          <input
            {...fieldProps("customerName")}
            className="loja__field"
            autoComplete="name"
            maxLength={CHECKOUT_LIMITS.customerName}
            value={form.customerName}
            onChange={(e) => update("customerName", e.target.value)}
          />
          {fieldError("customerName")}
        </div>

        <div>
          <label className="loja__label" htmlFor={FIELD_ID.customerPhone}>
            Telefone (com DDD) <span className="loja__required">(obrigatório)</span>
          </label>
          <input
            {...fieldProps("customerPhone")}
            className="loja__field"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={PHONE_INPUT_PROPS.maxLength}
            placeholder={PHONE_INPUT_PROPS.placeholder}
            value={form.customerPhone}
            onChange={(e) => update("customerPhone", maskPhoneInput(e.target.value))}
          />
          {fieldError("customerPhone")}
        </div>

        {form.deliveryType === "DELIVERY" && (
          <div>
            <label className="loja__label" htmlFor={FIELD_ID.address}>
              Endereço de entrega <span className="loja__required">(obrigatório)</span>
            </label>
            <input
              {...fieldProps("address")}
              className="loja__field"
              autoComplete="street-address"
              maxLength={CHECKOUT_LIMITS.address}
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
            />
            {fieldError("address")}
          </div>
        )}

        <div className="loja__coupon" data-invalid={couponError ? "true" : undefined}>
          <label className="loja__label" htmlFor="loja-cupom">
            <Icon name="coupons" size={19} />
            Cupom de desconto (opcional)
          </label>
          <input
            id="loja-cupom"
            className="loja__field loja__field--upper"
            autoComplete="off"
            aria-invalid={couponError ? true : undefined}
            aria-describedby={couponError ? "loja-cupom-erro" : undefined}
            maxLength={CHECKOUT_LIMITS.couponCode}
            value={form.couponCode}
            onChange={(e) => update("couponCode", e.target.value)}
          />
          {couponError && <p id="loja-cupom-erro" className="loja__error-text" role="alert">{couponError}</p>}
        </div>

        {PAYMENT_GROUPS.filter((group) => !group.online || pixEnabled).map((group) => (
          <fieldset key={group.legend} className="loja__fieldset">
            <legend className="loja__legend">{group.legend}</legend>
            {group.options.map((option) => (
              <label
                key={option.value}
                className={`loja__radio-card${form.paymentMethod === option.value ? " loja__radio-card--checked" : ""}`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  value={option.value}
                  checked={form.paymentMethod === option.value}
                  onChange={() => update("paymentMethod", option.value as PaymentMethod)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ))}

        {form.paymentMethod === "DINHEIRO" && (
          <div>
            <label className="loja__label" htmlFor={FIELD_ID.changeFor}>
              Troco para (opcional)
            </label>
            {/* A moldura inteira leva o foco ao campo (alvo de 44 px, não só o miolo do input). */}
            <div
              className="loja__money"
              data-invalid={errors.changeFor ? "true" : undefined}
              onClick={() => document.getElementById(FIELD_ID.changeFor)?.focus()}
            >
              <span aria-hidden="true">R$</span>
              <input
                {...fieldProps("changeFor")}
                inputMode="numeric"
                placeholder="0,00"
                value={form.changeFor}
                onChange={(e) => update("changeFor", maskMoneyInput(e.target.value))}
              />
            </div>
            {fieldError("changeFor")}
          </div>
        )}

        <fieldset className="loja__fieldset">
          <legend className="loja__legend">Gorjeta (opcional)</legend>
          <div className="loja__tips">
            {TIP_OPTIONS_CENTS.map((cents) => (
              <label key={cents} className={`loja__tip${form.tipCents === cents ? " loja__tip--active" : ""}`}>
                <input
                  type="radio"
                  name="tip"
                  className="sr-only"
                  value={cents}
                  checked={form.tipCents === cents}
                  onChange={() => update("tipCents", cents)}
                />
                {cents === 0 ? "Sem gorjeta" : formatCents(cents)}
              </label>
            ))}
          </div>
        </fieldset>

        <section className="loja__summary" aria-label="Resumo do pedido">
          <h3 className="loja__summary-title">Resumo do pedido</h3>
          <div className="loja__summary-row">
            <span>Subtotal</span>
            <span>{formatCents(totals.subtotalCents)}</span>
          </div>
          {delivery && (pendingZone || config || totals.deliveryFeeCents > 0) && (
            <div className="loja__summary-row">
              <span>Taxa de entrega</span>
              <span>{pendingZone ? "A confirmar" : formatCents(totals.deliveryFeeCents)}</span>
            </div>
          )}
          {totals.tipCents > 0 && (
            <div className="loja__summary-row">
              <span>Gorjeta</span>
              <span>{formatCents(totals.tipCents)}</span>
            </div>
          )}
          {quotedDiscount > 0 && (
            <div className="loja__summary-row"><span>Desconto do cupom</span><span>−{formatCents(quotedDiscount)}</span></div>
          )}
          <div className="loja__summary-row loja__summary-row--total">
            <span>{coupon && !activeQuote ? "Total antes do desconto" : "Total"}</span>
            <span>{pendingZone ? "A confirmar" : formatCents(totals.totalCents)}</span>
          </div>
          {coupon && !activeQuote && <p className="loja__hint">A loja verifica o cupom ao receber o pedido.</p>}
        </section>

        <button type="submit" disabled={submitting || blocked || pendingZone || missingPayment || (!store.pickupEnabled && !store.deliveryEnabled)} className="loja__cta">
          {submitting ? "Enviando…" : (activeQuote || errorCode === "ITEM_PRICE_CHANGED") ? (coupon && !activeQuote ? "Confirmar novo valor" : `Confirmar novo total · ${formatCents(totals.totalCents)}`) :
            later && scheduledFor ? `Agendar para ${scheduleLabel(scheduledFor, timeZone)}` : coupon || pendingZone ? "Finalizar pedido" : `Finalizar pedido · ${formatCents(totals.totalCents)}`}
        </button>
      </form>
    </Sheet>
  );
}
