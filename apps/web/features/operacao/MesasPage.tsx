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
import { TableQr } from "./TableQr";
import "./operacao.css";

type Table = { id: string; label: string; active: boolean; position: number; qrPath: string; free: boolean; pendingOrders: number; accountOrders: number; accountCents: number };
type Settings = { qrOrderingEnabled: boolean; qrOrdersNeedApproval: boolean };
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("DINHEIRO");
  const [change, setChange] = useState("");
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
    const result = await operationRequest<{ receipt?: { changeDueCents?: number | null } }>(path, method, body);
    if (result.ok) {
      const due = result.data?.receipt?.changeDueCents;
      setNotice(due == null ? message : `${message} Troco de ${formatCents(due)}.`);
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
    setChange("");
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

  function receive() {
    if (!accountPath || !account || account.table.id !== tableId) return;
    const changeForCents = paymentMethod === "DINHEIRO" && change ? Math.round(Number(change.replace(",", ".")) * 100) : undefined;
    if (changeForCents !== undefined && (!Number.isSafeInteger(changeForCents) || changeForCents < account.totalCents)) {
      setError("Informe um valor para troco que cubra o total da mesa.");
      return;
    }
    const body = { paymentMethod, changeForCents, expectedTotalCents: account.totalCents };
    void mutate(`${accountPath}/receive`, "POST", body, "Pagamento registrado.").then(ok => { if (ok) setChange(""); });
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
            <strong>Total {formatCents(account.totalCents)}</strong>
            {account.totalCents > 0 && <form className="operacao__stack" onSubmit={event => { event.preventDefault(); receive(); }}>
              <label>Forma de pagamento<select value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map(method => <option value={method.value} key={method.value}>{method.label}</option>)}</select></label>
              {paymentMethod === "DINHEIRO" && <label>Troco para (opcional)<input inputMode="decimal" placeholder="0,00" pattern="[0-9]+([,.][0-9]{1,2})?" value={change} onChange={event => setChange(event.target.value)} /></label>}
              <button className="operacao__primary" type="submit" disabled={busy || account.pendingOrders > 0}>Receber {formatCents(account.totalCents)}</button>
            </form>}
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
