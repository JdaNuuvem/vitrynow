"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ManualOrderInput, ManualOrderResult } from "@/core/domain/manualOrder";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { usePanelServices } from "@/core/services/PanelServices";
import { useStore, useStoreActions, useStoreCatalog } from "@/features/shell/StoreProvider";
import { formatCents } from "@/shared/format/money";
import { maskPhoneInput, PHONE_INPUT_PROPS } from "@/shared/format/phone";
import { Icon } from "@/shared/icons/Icon";
import { choiceLabels, lineChoicesValid, orderNeedsUpdatedCatalog } from "@/features/loja/productOptions";
import { ManualCatalog, ManualItemDialog } from "./ManualCatalog";
import { clearOpening, initialFields, lineCents, openingKey, toManualInput, type DraftLine, type ManualFields } from "./manualOrder";
import "./manual-order.css";

const reasonLabels = {
  CORTESIA: "Cortesia", ERRO_DO_PEDIDO: "Erro no pedido", CLIENTE_FREQUENTE: "Cliente frequente",
  PROMOCAO_DO_DIA: "Promoção do dia", OUTRO: "Outro",
};
const paymentLabels = {
  DINHEIRO: "Dinheiro", PIX: "Pix presencial", CREDITO: "Crédito", DEBITO: "Débito",
  VR: "Vale-refeição", VA: "Vale-alimentação",
};
type Attempt = { key: string; input: ManualOrderInput };
const unknownResult = "Ainda não foi possível confirmar o lançamento. Tente novamente com os mesmos dados.";
const orderHref = (id: string) => "/dashboard/pedidos?pedido=" + encodeURIComponent(id);

function OrderFields({ fields, set, owner }: {
  fields: ManualFields; owner: boolean;
  set: <K extends keyof ManualFields>(key: K, value: ManualFields[K]) => void;
}) {
  const delivery = fields.type === "DELIVERY";
  return <>
    <div className="manual-pair">
      <label>Modalidade<select value={fields.type} onChange={e => set("type", e.target.value as ManualFields["type"])}>
        <option value="BALCAO">Balcão</option><option value="DELIVERY">Entrega</option>
      </select></label>
      <label>Canal de origem<select value={fields.channel} onChange={e => set("channel", e.target.value as ManualFields["channel"])}>
        <option value="BALCAO">Balcão</option><option value="TELEFONE">Telefone</option><option value="WHATSAPP">WhatsApp</option><option value="OUTRO">Outro</option>
      </select></label>
    </div>
    <label>Nome do cliente<input autoComplete="off" maxLength={150} value={fields.customerName} onChange={e => set("customerName", e.target.value)} placeholder="Opcional" /></label>
    <label>Telefone{delivery && " (obrigatório)"}<input {...PHONE_INPUT_PROPS} autoComplete="off"
      required={delivery} value={fields.customerPhone} onChange={e => set("customerPhone", maskPhoneInput(e.target.value))} /></label>
    {delivery && <label>Endereço de entrega<textarea required maxLength={500} value={fields.address} onChange={e => set("address", e.target.value)} /></label>}
    <details><summary>Observações e descontos</summary>
      <div className="manual-fields">
        <label>Observação do pedido<textarea maxLength={500} value={fields.notes} onChange={e => set("notes", e.target.value)} /></label>
        <label>Cupom<input maxLength={50} value={fields.couponCode} onChange={e => set("couponCode", e.target.value)} /></label>
        {owner && fields.couponCode.trim() && <label className="manual-check"><input type="checkbox" checked={fields.forceCoupon} onChange={e => set("forceCoupon", e.target.checked)} />Autorizar uso de cupom esgotado</label>}
        <label>Desconto manual (%)<input type="number" min={0} max={100} step={1} value={fields.percent} onChange={e => set("percent", e.target.value)} /></label>
        {Number(fields.percent) > 0 && <label>Motivo do desconto<select value={fields.reason} onChange={e => set("reason", e.target.value as ManualFields["reason"])}>
          {Object.entries(reasonLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select></label>}
      </div>
    </details>
    <details><summary>Pagamento e gorjeta</summary>
      <div className="manual-fields">
        <label>Forma de pagamento<select required={fields.paid} value={fields.method} onChange={e => set("method", e.target.value as ManualFields["method"])}>
          <option value="">A definir</option>{Object.entries(paymentLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select></label>
        {fields.method === "DINHEIRO" && <label>Troco para (R$)<input type="number" min="0.01" max="1000000" step="0.01" value={fields.change} onChange={e => set("change", e.target.value)} /></label>}
        <label className="manual-check"><input type="checkbox" checked={fields.paid} onChange={e => set("paid", e.target.checked)} />Pagamento já recebido</label>
        <label>Gorjeta (R$)<input type="number" min="0" max="100000" step="0.01" value={fields.tip} onChange={e => set("tip", e.target.value)} /></label>
      </div>
    </details>
  </>;
}

export function ManualOrderPage() {
  const store = useStore();
  const { categories, error: catalogError } = useStoreCatalog();
  const { refreshCatalog } = useStoreActions();
  const { orders } = usePanelServices();
  const owner = useCurrentRole() === "OWNER";
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [itemDialog, setItemDialog] = useState<{ line: DraftLine; index: number | null } | null>(null);
  const [fields, setFields] = useState<ManualFields>(initialFields);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [checkingCatalog, setCheckingCatalog] = useState(false);
  const [needsNewPrice, setNeedsNewPrice] = useState(false);
  const [conflict, setConflict] = useState<ManualOrderResult | null>(null);
  const [created, setCreated] = useState<ManualOrderResult | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);
  const sending = useRef(false);
  const key = useRef<string | null>(null);
  const locked = busy || checkingCatalog || !!retry || !!conflict;
  const products = useMemo(() => new Map(categories?.flatMap((category) => category.products.map((product) => [product.id, product] as const)) ?? []), [categories]);
  const pricedLines = lines.map((line) => ({ ...line, product: products.get(line.product.id) ?? line.product }));
  const needsReview = (line: DraftLine) => {
    const product = products.get(line.product.id);
    return !product?.active || !!product.unavailableByOptions || !lineChoicesValid(product, line);
  };
  const hasReview = pricedLines.some(needsReview);
  const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = pricedLines.reduce((sum, line) => sum + lineCents(line), 0);

  useEffect(() => {
    if (!created) return;
    let current = true;
    orders.get(created.orderId).then(result => {
      if (current && result.ok && typeof result.data.order.totalCents === "number") setConfirmedTotal(result.data.order.totalCents);
    }).catch(() => {});
    return () => { current = false; };
  }, [created, orders]);

  function set<K extends keyof ManualFields>(field: K, value: ManualFields[K]) {
    setFields(old => ({ ...old, [field]: value }));
  }
  function reset() {
    if (store && key.current) clearOpening(store.id, key.current);
    key.current = null;
    setRetry(null); setConflict(null); setError(""); setCreated(null); setConfirmedTotal(null);
    setFields(initialFields); setLines([]); setNeedsNewPrice(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!store || !lines.length || sending.current || checkingCatalog || (!retry && hasReview) || created || conflict) return;
    if (!retry && fields.type === "DELIVERY" && !fields.address.trim()) {
      setError("Informe o endereço de entrega."); return;
    }
    const attempt = retry ?? { key: key.current ?? openingKey(store.id), input: toManualInput(pricedLines, fields, owner) };
    key.current = attempt.key;
    sending.current = true;
    setBusy(true); setError("");
    try {
      const result = await orders.createManual(attempt.input, attempt.key);
      if (result.ok && result.data?.orderId && result.data?.code) {
        clearOpening(store.id, attempt.key);
        setRetry(null); setCreated(result.data);
      } else if (!result.ok && result.status >= 400 && result.status < 500 && result.status !== 408) {
        setRetry(null);
        if (result.code === "IDEMPOTENCY_KEY_REUSED") {
          const previous = result.details as Partial<ManualOrderResult> | undefined;
          setConflict({ orderId: previous?.orderId || "", code: previous?.code || "" });
          setError("Uma tentativa anterior já gerou um pedido. Os dados desta tentativa não foram lançados.");
        } else {
          setError(result.error || "Confira os dados do pedido e tente novamente.");
          if (result.code === "ITEM_PRICE_CHANGED") setNeedsNewPrice(true);
          if (orderNeedsUpdatedCatalog(result.code)) {
            setCheckingCatalog(true);
            try { await refreshCatalog(); } finally { setCheckingCatalog(false); }
          }
        }
      } else {
        setRetry(attempt); setError(unknownResult);
      }
    } catch {
      setRetry(attempt); setError(unknownResult);
    } finally {
      sending.current = false; setBusy(false);
    }
  }

  return <main className="manual-page">
    <Link href="/dashboard/pedidos" className="manual-back">← Pedidos</Link>
    <h1>Novo pedido</h1>
    {created ? <section className="manual-success" aria-live="polite">
      <span className="manual-success__icon"><Icon name="orders" size={30} /></span>
      <h2>Pedido {created.code} confirmado</h2>
      {confirmedTotal !== null && <p>Total do pedido <strong>{formatCents(confirmedTotal)}</strong></p>}
      <div className="manual-actions"><Link href={orderHref(created.orderId)}>Abrir pedido</Link>
        <button type="button" className="manual-primary" onClick={reset}>Novo pedido</button></div>
    </section> : <div className="manual-layout">
      {categories ? <ManualCatalog categories={categories} disabled={locked || lines.length >= 100} configure={(product) => setItemDialog({
        index: null, line: { product, quantity: 1, additionalIds: [], notes: "" },
      })} />
        : <section className="manual-catalog" aria-live="polite"><h2>Cardápio</h2><p>{catalogError || "Carregando produtos…"}</p>
          {catalogError && <button type="button" onClick={() => void refreshCatalog()}>Tentar novamente</button>}</section>}
      <form className="manual-receipt" onSubmit={submit} onInvalid={e => {
        const field = e.target as HTMLElement;
        const details = field.closest("details");
        if (details) details.open = true;
      }}>
        <div className="manual-heading"><h2>Pedido atual</h2><span aria-live="polite">{quantity} {quantity === 1 ? "item" : "itens"}</span></div>
        {pricedLines.length ? <ul className="manual-lines">{pricedLines.map((line, i) => <li key={i}>
          <div><strong>{line.quantity} × {line.product.name}</strong>
            {choiceLabels(line.product, line).length > 0 && <small>{choiceLabels(line.product, line).join(" · ")}</small>}
            {line.notes && <small>{line.notes}</small>}
            {needsReview(line) && <small>Revise as opções ou remova o item.</small>}
            {products.get(line.product.id)?.active && !line.product.unavailableByOptions && <button type="button" disabled={locked} aria-label={"Editar " + line.product.name}
              onClick={() => setItemDialog({ line, index: i })}>Editar</button>}
            <button type="button" disabled={locked} aria-label={"Remover " + line.product.name} onClick={() => setLines(old => old.filter((_, index) => i !== index))}>Remover</button></div>
          <span>{formatCents(lineCents(line))}</span>
        </li>)}</ul> : <div className="manual-empty"><Icon name="orders" size={28} /><p>Escolha um produto no cardápio para começar.</p></div>}
        <fieldset className="manual-fields" disabled={locked}><legend>Dados do pedido</legend>
          <OrderFields fields={fields} set={set} owner={owner} />
        </fieldset>
        <div className="manual-subtotal"><span>Subtotal dos itens</span><strong>{formatCents(subtotal)}</strong></div>
        {fields.type === "DELIVERY" && store && <div className="manual-fee"><span>Taxa de entrega</span><span>{formatCents(store.deliveryFeeCents)}</span></div>}
        {error && <p className="manual-error" role="alert">{error}</p>}
        {conflict ? <div className="manual-actions">{conflict.orderId && <Link href={orderHref(conflict.orderId)}>Ver pedido {conflict.code}</Link>}
          <button type="button" onClick={reset}>Começar outro pedido</button></div>
          : <button className="manual-primary manual-submit" type="submit" disabled={!store || busy || checkingCatalog || (!retry && hasReview) || !lines.length}>
            {checkingCatalog ? "Atualizando cardápio…" : busy ? "Enviando…" : retry ? "Tentar novamente" : needsNewPrice ? "Confirmar novo valor" : "Confirmar pedido"}</button>}
      </form>
      {itemDialog && <ManualItemDialog
        initialLine={itemDialog.line}
        editing={itemDialog.index !== null}
        onClose={() => setItemDialog(null)}
        save={(line) => {
          const selected = itemDialog.index;
          setLines((current) => selected === null
            ? (current.length < 100 ? [...current, line] : current)
            : current.map((entry, index) => index === selected ? line : entry));
          setItemDialog(null);
        }}
      />}
    </div>}
  </main>;
}
