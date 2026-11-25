"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaymentCheck, PendingPixList } from "@/core/gateways/OrdersGateway";
import { usePanelServices } from "@/core/services/PanelServices";
import { formatCents } from "@/shared/format/money";
import { Button, PageHeading, StateMessage, StatusBadge } from "@/shared/design/components";
import { useNow } from "./hooks/useNow";
import "./pedidos.css";
import "./pedidos-acoes.css";
import { activeStoreTimezone, formatInStoreTimezone } from "@/shared/format/storeTime";
import { orderLabel } from "@/shared/format/orderCode";

const resultText: Record<PaymentCheck, string> = {
  PAID: "Pagamento confirmado pelo provedor.",
  NOT_PAID: "O provedor ainda não confirmou o pagamento.",
  UNVERIFIED: "O provedor não conseguiu verificar o pagamento. Tente novamente em um minuto.",
};

export function PendingPixPage() {
  const { orders } = usePanelServices();
  const [list, setList] = useState<PendingPixList | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState<string | null>(null);
  const [nextCheck, setNextCheck] = useState<Record<string, number>>({});
  const now = useNow(1000);
  const latest = useRef(0);
  const focusedHash = useRef("");
  const clearQueue = useCallback((message: string) => {
    latest.current++;
    setList(null);
    setNotice("");
    setError(message);
  }, []);
  const reload = useCallback(async () => {
    const seq = ++latest.current;
    const response = await orders.awaitingPayments();
    if (seq !== latest.current) return;
    if (response.ok) {
      setList(response.data);
      setError("");
    } else if ([401, 402, 403].includes(response.status)) {
      clearQueue(response.error);
    } else {
      setError(response.error);
    }
  }, [orders, clearQueue]);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 30_000);
    return () => { latest.current++; window.clearInterval(timer); };
  }, [reload]);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!list || !hash.startsWith("pix-") || focusedHash.current === hash) return;
    const item = document.getElementById(hash);
    if (item) {
      focusedHash.current = hash;
      item.focus();
    }
  }, [list]);

  async function check(id: string, code: string) {
    if (checking || (nextCheck[id] ?? 0) > Date.now()) return;
    setChecking(id);
    const response = await orders.checkPayment(id);
    setChecking(null);
    if (!response.ok && response.code !== "READ_ONLY" && [401, 402, 403].includes(response.status)) {
      clearQueue(response.error);
      return;
    }
    if (response.ok || response.status === 429) {
      setNextCheck((previous) => ({ ...previous, [id]: Date.now() + 60_000 }));
    }
    setNotice(`${orderLabel(code)}. ${response.ok ? resultText[response.data.result] : response.error}`);
    await reload();
  }

  return (
    <main className="pedidos">
      <PageHeading title="PIX pendentes" description="Consulte a confirmação do provedor antes de iniciar o preparo."
        actions={<Link href="/dashboard/pedidos" className="ds-button ds-button--secondary">Voltar aos pedidos</Link>} />
      {error && <StateMessage tone="danger" title={error} action={<Button onClick={reload}>Tentar novamente</Button>} />}
      {!list && !error && <StateMessage title="Consultando pagamentos…" busy />}
      {notice && <StateMessage tone="info" title={notice} />}
      {list && <>
        <h2 className="pix-queue__title">{list.count === 200 ? "200 resultados mais antigos" : `${list.count} ${list.count === 1 ? "pedido aguardando" : "pedidos aguardando"}`}</h2>
        {list.orders.length === 0 && <StateMessage title="Nenhum PIX pendente na última consulta." />}
        <ul className="pix-queue">
          {list.orders.map((item) => (
            <li key={item.id} id={`pix-${item.id}`} tabIndex={-1}>
              <div><strong>#{item.code}</strong> · {item.customerName || "Cliente"}<br />
                <small>{formatInStoreTimezone(item.createdAt, activeStoreTimezone(), { dateStyle: "short", timeStyle: "short" })}{item.expiresAt ? ` · Vencimento às ${formatInStoreTimezone(item.expiresAt, activeStoreTimezone(), { hour: "2-digit", minute: "2-digit" })}` : ""}</small>
              </div>
              <strong>{formatCents(item.totalCents)}</strong>
              <StatusBadge tone={item.expiresAt && Date.parse(item.expiresAt) < now ? "danger" : "warning"}>
                {item.expiresAt && Date.parse(item.expiresAt) < now ? "Prazo expirado" : "Aguardando confirmação"}
              </StatusBadge>
              <Button disabled={checking !== null || (nextCheck[item.id] ?? 0) > now} onClick={() => void check(item.id, item.code)}>
                {checking === item.id ? "Conferindo…" : (nextCheck[item.id] ?? 0) > now ? "Aguarde um minuto" : "Conferir pagamento"}
              </Button>
            </li>
          ))}
        </ul>
      </>}
    </main>
  );
}
