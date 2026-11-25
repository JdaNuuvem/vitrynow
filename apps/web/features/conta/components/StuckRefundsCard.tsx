"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { DataTable, Panel } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { activeStoreTimezone, formatInStoreTimezone } from "@/shared/format/storeTime";

// API-69: estornos que a devolução automática desistiu de tentar (só o dono vê). Cada um abre o pedido, onde o dono
// registra a devolução feita por fora ou encerra o estorno com o motivo.
const http = new FetchHttpClient();
type Stuck = { count: number; orders: { id: string; code: string; createdAt: string; amountCents: number }[] };

export function StuckRefundsCard() {
  const [data, setData] = useState<Stuck | null>(null);
  useEffect(() => {
    let alive = true;
    void http.get<Stuck>("/api/orders/refund-stuck").then((result) => { if (alive && result.ok) setData(result.data); });
    return () => { alive = false; };
  }, []);
  if (!data || data.count === 0) return null;
  return <Panel title={`Estornos travados (${data.count})`}>
    <p className="conta__meta">A devolução automática parou de tentar nestes pedidos. Abra cada um para registrar a devolução feita por fora ou encerrar o estorno.</p>
    <DataTable label="Estornos travados" headers={["Pedido", "Data", "Valor", ""]}>
      {data.orders.map((order) => <tr key={order.id}>
        <td>#{order.code}</td>
        <td>{formatInStoreTimezone(order.createdAt, activeStoreTimezone(), { dateStyle: "short" })}</td>
        <td>{formatCents(order.amountCents)}</td>
        <td><Link className="ds-button ds-button--secondary" href={`/dashboard/pedidos/historico?pedido=${encodeURIComponent(order.id)}`}>Abrir pedido</Link></td>
      </tr>)}
    </DataTable>
  </Panel>;
}
