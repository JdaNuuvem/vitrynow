"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PaymentMethod } from "@/core/domain/storefront";
import { statusLabel } from "@/core/domain/orderLabels";
import { usePanelServices } from "@/core/services/PanelServices";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { formatCents } from "@/shared/format/money";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { PageHeading, StatusBadge } from "@/shared/design/components";
import { operationRequest } from "./storeOperations";
import { buildReceiveBody, closeTotals, parseMoney, remainingCents, type PaymentPart } from "./tableClose";
import { TableQr } from "./TableQr";
import "./operacao.css";

type Table = { id: string; label: string; active: boolean; position: number; qrPath: string; free: boolean; pendingOrders: number; accountOrders: number; accountCents: number };
type Settings = { qrOrderingEnabled: boolean; qrOrdersNeedApproval: boolean; serviceFeePercent?: number };
type Confirmation = { kind: "approval" } | { kind: "rotate"; table: Table };
type Tables = { tables: Table[]; settings: Settings };
type Account = {
  table: { id: string; label: string };
  orders: { id: string; code: string; status: string; totalCents: number }[];
  pendingOrders: number;
  totalCents: number;
};
const PAYMENT_METHODS: { label: string; value: PaymentMethod }[] = [
  { label: "Dinheiro", value: "DINHEIRO" }, { label: "Pix", value: "PIX" },
  { label: "Crédito", value: "CREDITO" }, { label: "Débito", value: "DEBITO" },
  { label: "Vale-refeição", value: "VR" }, { label: "Vale-alimentação", value: "VA" },
];

export function MesasPage() {
  const owner = useCurrentRole() === "OWNER";
  const { realtime } = usePanelServices();
  const [data, setData] = useState<Tables | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [rename, setRename] = useState("");
  // Fechamento: 1 forma = pagamento único; 2 a 10 = conta dividida (PRO). Taxa de serviço opcional e desconto em R$ (todos os planos).
  const partSeq = useRef(0);
  const newPart = (method: PaymentMethod = "DINHEIRO"): PaymentPart => ({ key: ++partSeq.current, method, amount: "", changeFor: "" });
  const [parts, setParts] = useState<PaymentPart[]>(() => [newPart()]);
  const [includeFee, setIncludeFee] = useState(true);
  const [discount, setDiscount] = useState("");
  const [feeInput, setFeeInput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printedQr, setPrintedQr] = useState<{ label: string; href: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [request, setRequest] = useState<{ tableId: string; text: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const listRequest = useRef(0);
  const accountRequest = useRef(0);
  const selected = data?.tables.find(table => table.id === tableId);
  const accountPath = tableId ? `/api/tables/${encodeURIComponent(tableId)}` : null;

  const reload = useCallback(async () => {
    const version = ++listRequest.current;
    const result = await operationRequest<Tables>("/api/tables");
    if (version !== listRequest.current) return;
    if (result.ok) setData(result.data);
    else setError(result.error);
  }, []);

  const loadAccount = useCallback(async () => {
    if (!accountPath) return;
    const version = ++accountRequest.current;
    const result = await operationRequest<Account>(`${accountPath}/account`);
    if (version !== accountRequest.current) return;
    if (result.ok) setAccount(result.data);
    else setError(result.error);
  }, [accountPath]);

  useEffect(() => {
    void reload();
    return () => { listRequest.current += 1; };
  }, [reload]);
  useEffect(() => {
    void loadAccount();
    return () => { accountRequest.current += 1; };
  }, [loadAccount]);
  useEffect(() => realtime.subscribe(event => {
    if (event?.type === "table.alert" && event.tableId) {
      const text = event.kind === "CALL_WAITER" ? "chamou o atendente"
        : event.kind === "ASK_BILL" ? "pediu a conta" : "tem vários pedidos pendentes";
      setRequest({ tableId: event.tableId, text });
    }
    if (!event?.type || event.type.startsWith("order.")) {
      void reload();
      void loadAccount();
    }
  }), [realtime, reload, loadAccount]);

  async function mutate(path: string, method: string, body: unknown, message: string, inDialog = false) {
    if (busy) return false;
    setBusy(true);
    setError("");
    setNotice("");
    const result = await operationRequest<{ receipt?: { totalCents?: number; changeDueCents?: number | null; payments?: { changeDueCents: number | null }[] } }>(path, method, body);
    if (result.ok) {
      const receipt = result.data?.receipt;
      const due = (receipt?.payments ?? []).reduce((sum, p) => sum + (p.changeDueCents ?? 0), 0) || receipt?.changeDueCents || 0;
      const total = receipt?.totalCents !== undefined ? ` Total ${formatCents(receipt.totalCents)}.` : "";
      setNotice(`${message}${total}${due > 0 ? ` Troco de ${formatCents(due)}.` : ""}`);
      await reload();
      if (path.endsWith("/receive")) await loadAccount();
    } else {
      if (path.endsWith("/receive")) await loadAccount();
      if (inDialog) setConfirmationError(result.error);
      else setError(result.error);
    }
    setBusy(false);
    return result.ok;
  }

  function confirm(action: Confirmation | null) {
    setConfirmation(action);
    setConfirmationError(null);
  }

  async function runConfirmation() {
    if (!confirmation) return;
    const ok = confirmation.kind === "approval"
      ? await mutate("/api/store/qr-settings", "POST", { qrOrdersNeedApproval: false, confirmNoApproval: true }, "Configuração salva.", true)
      : await mutate(`/api/tables/${encodeURIComponent(confirmation.table.id)}/regenerate-qr`, "POST", undefined, "Novo link gerado.", true);
    if (ok) confirm(null);
  }

  function select(table: Table) {
    setAccount(null);
    setTableId(table.id);
    setRename(table.label);
    resetClose();
    setError("");
    setNotice("");
  }

  async function copyLink(path: string) {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setNotice("Link copiado.");
      setError("");
    } catch {
      setError("Não foi possível copiar o link. Use Abrir cardápio para copiá-lo na barra de endereço.");
    }
  }

  function resetClose() {
    setParts([newPart()]);
    setDiscount("");
    setIncludeFee(true);
  }

  const feePercent = data?.settings.serviceFeePercent ?? 0;
  const feeOn = includeFee && feePercent > 0;
  const discountCents = parseMoney(discount) ?? 0;
  const totals = account ? closeTotals(account.totalCents, feePercent, feeOn, discountCents) : null;
  const toInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

  function updatePart(key: number, patch: Partial<PaymentPart>) {
    setParts(current => current.map(part => (part.key === key ? { ...part, ...patch } : part)));
  }

  // Ao dividir, a 1ª parte recebe o total e cada nova o que faltar: o atendente só ajusta os valores.
  function addPart(totalCents: number) {
    setParts(current => {
      if (current.length === 1) return [{ ...current[0], amount: toInput(totalCents) }, newPart("PIX")];
      const rest = remainingCents(totalCents, current);
      return [...current, { ...newPart("PIX"), amount: rest > 0 ? toInput(rest) : "" }];
    });
  }

  function removePart(key: number) {
    setParts(current => {
      const left = current.filter(part => part.key !== key);
      return left.length === 1 ? [{ ...left[0], amount: "" }] : left; // voltou a pagamento único
    });
  }

  function receive() {
    if (!accountPath || !account || account.table.id !== tableId) return;
    const built = buildReceiveBody({ subtotalCents: account.totalCents, serviceFeePercent: feePercent, includeFee: feeOn, discount, parts });
    if (!built.ok) {
      setError(built.error);
      return;
    }
    void mutate(`${accountPath}/receive`, "POST", built.body, "Pagamento registrado.").then(ok => { if (ok) resetClose(); });
  }

  return <main className="operacao">
    <PageHeading title="Mesas" description="Gerencie os links de mesa, acompanhe pedidos e receba a conta." />
    {error && <p className="operacao__message" role="alert">{error}</p>}
    {notice && <p className="operacao__message" role="status">{notice}</p>}
    {request && <div className="operacao__message operacao__row operacao__row--spread" role="status">
      <span>{data?.tables.find(table => table.id === request.tableId)?.label ?? "Uma mesa"} {request.text}.</span>
      <button type="button" onClick={() => setRequest(null)}>Dispensar</button>
    </div>}
    {!data ? error ? <button type="button" onClick={reload}>Tentar novamente</button> : <p role="status">Carregando mesas…</p> : <div className="operacao__grid">
      <div>
        {owner && <form className="operacao__card" onSubmit={event => {
          event.preventDefault();
          void mutate("/api/tables", "POST", { label: label.trim() }, "Mesa cadastrada.").then(ok => { if (ok) setLabel(""); });
        }}>
          <h2>Adicionar mesa</h2>
          <div className="operacao__row">
            <label>Nome da mesa<input required maxLength={40} value={label} placeholder="Ex. Mesa 01" onChange={event => setLabel(event.target.value)} /></label>
            <button type="submit" className="operacao__primary" disabled={busy || !label.trim()}>Adicionar</button>
          </div>
        </form>}
        <section className="operacao__card">
          <div className="operacao__row operacao__row--spread"><h2>Mesas cadastradas</h2><button type="button" onClick={reload}>Atualizar</button></div>
          {!data.tables.length ? <p className="operacao__muted">Nenhuma mesa cadastrada.</p> : <ul className="operacao__list">
            {data.tables.map(table => <li key={table.id} className="operacao__row operacao__row--spread">
              <div><strong>{table.label}</strong><br /><StatusBadge tone={!table.active ? "neutral" : table.free ? "success" : "warning"}>{!table.active ? "Inativa" : table.free ? "Livre" : `${table.pendingOrders} pendente(s) · ${formatCents(table.accountCents)} em aberto`}</StatusBadge></div>
              <button type="button" disabled={busy || table.id === tableId} onClick={() => select(table)}>Ver mesa</button>
            </li>)}
          </ul>}
        </section>
      </div>
      <div>
        {owner && <section className="operacao__card">
          <h2>Pedidos pelo QR</h2>
          <label className="operacao__check"><input type="checkbox" checked={data.settings.qrOrderingEnabled} disabled={busy} onChange={event => void mutate("/api/store/qr-settings", "POST", { qrOrderingEnabled: event.target.checked }, "Configuração salva.")} /> Aceitar pedidos pelo cardápio da mesa</label>
          <label className="operacao__check"><input type="checkbox" checked={data.settings.qrOrdersNeedApproval} disabled={busy} onChange={event => {
            const needsApproval = event.target.checked;
            if (!needsApproval) confirm({ kind: "approval" });
            else void mutate("/api/store/qr-settings", "POST", { qrOrdersNeedApproval: true }, "Configuração salva.");
          }} /> Exigir aceite da equipe</label>
          <form className="operacao__row" onSubmit={event => {
            event.preventDefault();
            const percent = Number(feeInput);
            if (feeInput === null || feeInput.trim() === "" || !Number.isInteger(percent) || percent < 0 || percent > 30) { setError("A taxa de serviço vai de 0 a 30%."); return; }
            void mutate("/api/store/qr-settings", "POST", { serviceFeePercent: percent }, "Taxa de serviço salva.").then(ok => { if (ok) setFeeInput(null); });
          }}>
            <label>Taxa de serviço sugerida (%)<input type="number" min={0} max={30} step={1} value={feeInput ?? String(feePercent)} disabled={busy} onChange={event => setFeeInput(event.target.value)} /></label>
            <button type="submit" disabled={busy || feeInput === null || feeInput === String(feePercent)}>Salvar</button>
          </form>
          <p className="operacao__muted">Vem marcada no fechamento da mesa e pode ser tirada em cada conta. 0 = a loja não cobra.</p>
        </section>}
        {selected && accountPath && <section className="operacao__card">
          <div className="operacao__row operacao__row--spread"><h2>{selected.label}</h2><button type="button" disabled={busy} onClick={loadAccount}>Atualizar conta</button></div>
          <div className="operacao__row">
            {selected.active && <button type="button" onClick={() => setPrintedQr({ label: selected.label, href: new URL(selected.qrPath, window.location.origin).href })}>Ver código QR</button>}
            <button type="button" onClick={() => copyLink(selected.qrPath)}>Copiar link</button>
            {selected.active && <Link className="operacao__button" href={selected.qrPath} target="_blank" rel="noreferrer">Abrir cardápio</Link>}
          </div>
          {owner && <>
            <form className="operacao__row" onSubmit={event => { event.preventDefault(); void mutate(accountPath, "PATCH", { label: rename.trim() }, "Nome da mesa atualizado."); }}>
              <label>Nome<input required maxLength={40} value={rename} onChange={event => setRename(event.target.value)} /></label>
              <button type="submit" disabled={busy || !rename.trim() || rename.trim() === selected.label}>Renomear</button>
            </form>
            <div className="operacao__row">
              <button type="button" disabled={busy} onClick={() => mutate(accountPath, "PATCH", { active: !selected.active }, selected.active ? "Mesa desativada." : "Mesa ativada.")}>{selected.active ? "Desativar" : "Ativar"}</button>
              <button type="button" disabled={busy} onClick={() => confirm({ kind: "rotate", table: selected })}>Trocar QR</button>
            </div>
          </>}
          {account?.table.id === tableId ? <>
            <h2>Conta da mesa</h2>
            {account.pendingOrders > 0 && <p className="operacao__muted">Aceite ou recuse os {account.pendingOrders} pedido(s) pendente(s) antes de receber.</p>}
            {account.orders.length ? <ul className="operacao__list">{account.orders.map(order => <li key={order.id} className="operacao__row operacao__row--spread"><span>Pedido {order.code} · {statusLabel(order.status)}</span><strong>{formatCents(order.totalCents)}</strong></li>)}</ul> : <p className="operacao__muted">Nenhum pedido em aberto.</p>}
            {account.totalCents > 0 && totals ? <form className="operacao__stack" onSubmit={event => { event.preventDefault(); receive(); }}>
              <dl className="operacao__summary">
                <div><dt>Consumo</dt><dd>{formatCents(account.totalCents)}</dd></div>
                {feePercent > 0 && <div>
                  <dt><label className="operacao__check"><input type="checkbox" checked={includeFee} disabled={busy} onChange={event => setIncludeFee(event.target.checked)} /> Taxa de serviço ({feePercent}%)</label></dt>
                  <dd>{feeOn ? formatCents(totals.serviceFeeCents) : "—"}</dd>
                </div>}
                <div>
                  <dt><label>Desconto (R$)<input inputMode="decimal" placeholder="0,00" value={discount} disabled={busy} onChange={event => setDiscount(event.target.value)} /></label></dt>
                  <dd>{discountCents > 0 ? `− ${formatCents(discountCents)}` : "—"}</dd>
                </div>
                <div className="operacao__summary-total"><dt>Total a receber</dt><dd>{formatCents(totals.totalCents)}</dd></div>
              </dl>
              {parts.map((part, index) => <fieldset key={part.key} className="operacao__payment">
                <legend>{parts.length > 1 ? `Pagamento ${index + 1}` : "Pagamento"}</legend>
                <div className="operacao__row">
                  <label>Forma<select value={part.method} disabled={busy} onChange={event => updatePart(part.key, { method: event.target.value as PaymentMethod, changeFor: "" })}>
                    {PAYMENT_METHODS.map(method => <option value={method.value} key={method.value}>{method.label}</option>)}
                  </select></label>
                  {parts.length > 1 && <label>Valor (R$)<input inputMode="decimal" placeholder="0,00" required value={part.amount} disabled={busy} onChange={event => updatePart(part.key, { amount: event.target.value })} /></label>}
                  {part.method === "DINHEIRO" && <label>Troco para (opcional)<input inputMode="decimal" placeholder="0,00" value={part.changeFor} disabled={busy} onChange={event => updatePart(part.key, { changeFor: event.target.value })} /></label>}
                  {parts.length > 1 && <button type="button" disabled={busy} onClick={() => removePart(part.key)}>Remover</button>}
                </div>
              </fieldset>)}
              <div className="operacao__row operacao__row--spread">
                <button type="button" disabled={busy || parts.length >= 10} onClick={() => addPart(totals.totalCents)}>{parts.length > 1 ? "Adicionar forma" : "Dividir a conta"}</button>
                {parts.length > 1 && (() => {
                  const rest = remainingCents(totals.totalCents, parts);
                  return <span className={rest === 0 ? "operacao__muted" : "operacao__warning"} role="status">{rest === 0 ? "Divisão fechada" : rest > 0 ? `Faltam ${formatCents(rest)}` : `Sobram ${formatCents(-rest)}`}</span>;
                })()}
              </div>
              {parts.length > 1 && <p className="operacao__muted">Dividir a conta é do plano PRO. Dinheiro em qualquer parte exige o caixa aberto.</p>}
              <button className="operacao__primary" type="submit" disabled={busy || account.pendingOrders > 0 || totals.totalCents <= 0 || (parts.length > 1 && remainingCents(totals.totalCents, parts) !== 0)}>Receber {formatCents(totals.totalCents)}</button>
            </form> : <strong>Total {formatCents(account.totalCents)}</strong>}
          </> : <p role="status">Carregando conta…</p>}
        </section>}
      </div>
    </div>}
    {printedQr && <TableQr {...printedQr} onClose={() => setPrintedQr(null)} />}
    <ConfirmDialog open={confirmation !== null} busy={busy} error={confirmationError}
      title={confirmation?.kind === "approval" ? "Desativar o aceite da equipe?" : "Gerar um novo código QR?"}
      message={confirmation?.kind === "approval" ? "Pedidos feitos pelo QR seguirão direto para a cozinha." : "O código QR e o link anteriores deixarão de abrir o cardápio da mesa."}
      confirmLabel={confirmation?.kind === "approval" ? "Desativar aceite" : "Gerar novo QR"}
      onConfirm={runConfirmation} onCancel={() => { if (!busy) confirm(null); }} />
  </main>;
}
