"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ScheduledOrder } from "@/core/domain/orders";
import { usePanelServices } from "@/core/services/PanelServices";
import { Button, DataTable, PageHeading, StateMessage, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { localParts } from "@/features/loja/scheduleSlots";
import { useStoreTimezone } from "@/features/shell/useStoreTimezone";

// API-40 — agenda da equipe: pedidos agendados que ainda NÃO entraram no kanban. Cada um entra sozinho no horário
// escolhido menos o tempo de preparo (job schedule.release), já com o tíquete. Aceitar antes ou cancelar
// ("A loja não conseguiu atender no horário agendado") é pelo detalhe do pedido, como qualquer outro.

const TYPE_LABEL: Record<string, string> = { DELIVERY: "Entrega", BALCAO: "Retirada", MESA: "Mesa" };
const pad = (n: number) => String(n).padStart(2, "0");

function dayKey(iso: string, timeZone: string) {
  const p = localParts(new Date(iso), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function ScheduledOrdersPage() {
  const timeZone = useStoreTimezone(); // SSOT D1: agenda no fuso da LOJA
  const router = useRouter();
  const { orders: gateway, realtime } = usePanelServices();
  const [orders, setOrders] = useState<ScheduledOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    const result = await gateway.scheduled();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return setError(result.error);
    }
    setOrders(result.data.orders);
  }, [gateway, router]);

  useEffect(() => {
    void reload();
    // novo agendamento, aceite, cancelamento ou liberação para a cozinha: a lista muda
    return realtime.subscribe((event) => { if (!event?.type || event.type.startsWith("order.")) void reload(); });
  }, [reload, realtime]);

  const today = dayKey(new Date().toISOString(), timeZone);
  const groups = new Map<string, ScheduledOrder[]>();
  for (const order of orders ?? []) groups.set(dayKey(order.scheduledFor, timeZone), [...(groups.get(dayKey(order.scheduledFor, timeZone)) ?? []), order]);
  const hour = (iso: string) => { const p = localParts(new Date(iso), timeZone); return `${pad(p.hour)}:${pad(p.minute)}`; };
  const dayTitle = (key: string) => {
    if (key === today) return "Hoje";
    const [y, m, d] = key.split("-");
    return `${d}/${m}/${y}`;
  };

  return <main className="pedidos">
    <PageHeading title="Pedidos agendados" description="Entram sozinhos no quadro de pedidos no horário escolhido, menos o tempo de preparo."
      actions={<Link href="/dashboard/pedidos" className="ds-button ds-button--secondary">Voltar aos pedidos</Link>} />
    {error && <StateMessage tone="danger" title="Agenda indisponível" action={<Button onClick={() => void reload()}>Tentar novamente</Button>}>{error}</StateMessage>}
    {!orders && !error && <StateMessage title="Carregando agenda" busy />}
    {orders && orders.length === 0 && <StateMessage title="Nenhum pedido agendado">Quando um cliente agendar pelo cardápio, ele aparece aqui até a hora de preparar.</StateMessage>}
    {[...groups.entries()].map(([key, list]) => <section key={key} className="pedidos__scheduled-day">
      <h2>{dayTitle(key)} <span className="pedidos__muted">· {list.length} pedido(s)</span></h2>
      <DataTable label={`Agendados ${dayTitle(key)}`} headers={["Horário", "Pedido", "Cliente", "Itens", "Pagamento", "Total", ""]}>
        {list.map((order) => <tr key={order.id}>
          <td><strong>{hour(order.scheduledFor)}</strong></td>
          <td>#{order.code} · {TYPE_LABEL[order.type] ?? order.type}{order.status === "CONFIRMADO" && <> <StatusBadge tone="success">Aceito</StatusBadge></>}</td>
          <td>{order.customerName ?? "—"}</td>
          <td>{order.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")}</td>
          <td>{order.paidAt ? <StatusBadge tone="success">Pago</StatusBadge> : order.paymentMethod ?? "—"}</td>
          <td>{formatCents(order.totalCents)}</td>
          <td><Link className="ds-button ds-button--secondary" href={`/dashboard/pedidos?pedido=${encodeURIComponent(order.id)}`}>Abrir</Link></td>
        </tr>)}
      </DataTable>
    </section>)}
  </main>;
}
