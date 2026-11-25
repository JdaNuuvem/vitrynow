"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Button, DataTable, Panel } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { PlatformCredits } from "./PlatformCredits";
import { PlatformStoreAction } from "./PlatformStoreAction";
import { platformApi, type StoreAction } from "./platformApi";
import { platformDate, PlatformHeading, PlatformState, StoreStatus } from "./PlatformUi";
import { usePlatformResource } from "./usePlatformResource";

const PAYOUT_LABELS: Record<string, string> = { CONNECTED: "Conectado", REVOKED: "Revogado", NOT_CONNECTED: "Desconectado", DISCONNECTED: "Desconectado", RECONNECT_REQUIRED: "Reconexão necessária" };
const PAYMENT_LABELS: Record<string, string> = { PENDENTE: "Pendente", APROVADO: "Aprovado", REJEITADO: "Rejeitado", EXPIRADO: "Expirado", REEMBOLSADO: "Reembolsado" };

export function PlatformStoreDetail({ id }: { id: string }) {
  const load = useCallback(() => platformApi.store(id), [id]);
  const { loading, data, error, reload } = usePlatformResource(load);
  const [action, setAction] = useState<StoreAction | null>(null);
  const [notice, setNotice] = useState("");

  return <>
    <Link className="platform-back" href="/plataforma">← Voltar para lojas</Link>
    {loading || error || !data ? <PlatformState loading={loading} error={error} retry={reload} /> : <>
      <PlatformHeading title={data.store.name} description={`${data.store.slug} · ${data.store.code}`}
        action={<StoreStatus suspended={data.store.suspended} subscription={data.subscription} />} />
      {notice && <p className="platform-message platform-message--ok" role="status">{notice}</p>}
      <div className="platform-grid">
        <section className="platform-panel" aria-labelledby="platform-operation-title">
          <h2 id="platform-operation-title">Operação</h2>
          <dl className="platform-details">
            <div><dt>Responsável</dt><dd>{data.store.ownerEmail ?? "—"}</dd></div>
            <div><dt>Cadastro</dt><dd>{platformDate(data.store.createdAt)}</dd></div>
            <div><dt>Recebimento de pedidos</dt><dd>{data.store.suspended || data.subscription?.phase === "READ_ONLY" || data.subscription?.phase === "SUSPENDED"
              ? "Bloqueado" : data.store.acceptingOrders ? "Ativado nas configurações" : "Desativado nas configurações"}</dd></div>
            <div><dt>Conta de pagamento</dt><dd>{PAYOUT_LABELS[data.store.paymentStatus] ?? data.store.paymentStatus}</dd></div>
            {data.store.suspended && <><div><dt>Suspensão da plataforma</dt><dd>{platformDate(data.store.suspendedAt)}</dd></div>
              <div><dt>Motivo</dt><dd>{data.store.suspendedReason ?? "—"}</dd></div></>}
          </dl>
          <div className="platform-actions">
            <Link className="ds-button ds-button--secondary" href={`/loja/${encodeURIComponent(data.store.slug)}`} target="_blank" rel="noopener noreferrer">Abrir cardápio</Link>
            <Button onClick={() => setAction(data.store.suspended ? "reactivate" : "suspend")}>{data.store.suspended ? "Reativar loja" : "Suspender loja"}</Button>
          </div>
        </section>
        <section className="platform-panel" aria-labelledby="platform-subscription-title">
          <h2 id="platform-subscription-title">Assinatura</h2>
          {data.subscription ? <>
            <dl className="platform-details">
              <div><dt>Plano</dt><dd>{data.subscription.planName ?? (data.subscription.status === "TRIAL" ? "Período de teste" : "—")}</dd></div>
              <div><dt>Fim do teste</dt><dd>{platformDate(data.subscription.trialEndsAt)}</dd></div>
              <div><dt>Fim do período atual</dt><dd>{platformDate(data.subscription.currentPeriodEnd)}</dd></div>
            </dl>
            {data.subscription.status === "TRIAL" && <Button onClick={() => setAction("extend-trial")}>Estender período de teste</Button>}
          </> : <p className="platform-muted">A loja ainda não tem uma assinatura cadastrada.</p>}
        </section>
      </div>
      <Panel title="Pagamentos da assinatura">
        {!data.subscriptionPayments.length ? <PlatformState>Nenhum pagamento registrado.</PlatformState> :
          <DataTable label="Tabela de pagamentos da assinatura" headers={["Data", "Plano", "Situação", "Valor"]}>
            {data.subscriptionPayments.map((payment) => <tr key={payment.id}><td>{platformDate(payment.createdAt)}</td><td>{payment.planCode}</td>
              <td>{PAYMENT_LABELS[payment.status] ?? payment.status}</td><td>{formatCents(payment.amountCents)}</td></tr>)}
          </DataTable>}
      </Panel>
      <PlatformCredits storeId={id} storeName={data.store.name} />
      {action && <PlatformStoreAction storeId={id} name={data.store.name} action={action} onClose={() => setAction(null)} onDone={(label) => {
        setAction(null); setNotice(label); reload();
      }} />}
    </>}
  </>;
}
