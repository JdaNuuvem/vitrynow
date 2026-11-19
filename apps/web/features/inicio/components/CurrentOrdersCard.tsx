import Link from "next/link";
import type { HistoryResponse } from "@/core/domain/orderHistory";
import type { PendingPixList } from "@/core/gateways/OrdersGateway";
import { formatWhen, statusChip, typeLabel } from "@/features/pedidos/historico/historyFormat";
import { Icon, type IconName } from "@/shared/icons/Icon";
import { Shine } from "@/shared/ui/Shine";
import { formatCents } from "@/shared/format/money";
import { STORE_TIMEZONE } from "../services/salesDefinition";

const PIX_HREF = "/dashboard/pedidos/pix";
const OPEN_HREF = "/dashboard/pedidos/historico?status=ABERTO";

type QueueProps = {
  title: string;
  error: string | null;
  hidden: boolean;
} & ({ waiting: true; data: PendingPixList | null } | { waiting?: false; data: HistoryResponse | null });

const typeIcons: Record<string, IconName> = { MESA: "mesa", BALCAO: "pickup", DELIVERY: "delivery" };

export function CurrentOrdersCard(props: QueueProps) {
  const { waiting, data, title, error, hidden } = props;
  const total = waiting ? data?.count : data?.total;
  const rows = waiting ? data?.orders.slice(0, 4).map((row) => ({
    ...row,
    href: `${PIX_HREF}#pix-${encodeURIComponent(row.id)}`,
    typeLabel: "Pix",
    icon: "payments" as const,
    when: formatWhen(row.createdAt, STORE_TIMEZONE),
    status: "Aguardando pagamento",
    tone: "pending",
  })) : data?.rows.map((row) => ({
    ...row,
    href: `/dashboard/pedidos?pedido=${encodeURIComponent(row.id)}`,
    typeLabel: typeLabel(row.type),
    icon: typeIcons[row.type] ?? "orders",
    when: formatWhen(row.createdAt, data.timezone),
    status: statusChip(row).text,
    tone: row.status === "PRONTO" ? "ready" : "open",
  }));

  return (
    <section className="inicio-card inicio-queue">
      <div className="inicio-queue__head">
        <h2>{title}</h2>
        {total !== undefined && <span className="inicio-queue__count">{waiting && total === 200 ? "200+" : total}</span>}
      </div>
      <div className="inicio-queue__list" aria-busy={!data && !error}>
        {!data && (error ? <p className="inicio-muted">Dados indisponíveis.</p> : <Shine height={120} />)}
        {total === 0 && (
          <div className="inicio-queue__empty">
            <span><Icon name={waiting ? "payments" : "orders"} size={26} /></span>
            <strong>{waiting ? "Nenhum Pix pendente" : "Nenhum pedido em andamento"}</strong>
          </div>
        )}
        {rows?.map((row) => (
          <Link key={row.id} href={row.href} className="inicio-order">
            <div className="inicio-order__top">
              <span>Pedido <strong>#{row.code.replace(/^#/, "")}</strong> / {row.typeLabel}</span>
              <time dateTime={row.createdAt}>{row.when}</time>
            </div>
            <div className="inicio-order__customer">
              <span className="inicio-order__icon"><Icon name={row.icon} size={21} /></span>
              <div><strong>{row.customerName?.trim() || "Cliente não informado"}</strong></div>
            </div>
            <div className={`inicio-order__bottom inicio-order__bottom--${row.tone}`}>
              <span><Icon name={row.tone === "ready" ? "check" : "clock"} size={14} />{row.status}</span>
              <strong>{hidden ? "••••" : formatCents(row.totalCents)}<Icon name="chevronRight" size={14} /></strong>
            </div>
          </Link>
        ))}
      </div>
      <Link className="inicio-queue__foot" href={waiting ? PIX_HREF : OPEN_HREF}>
        {waiting ? "Ver Pix pendentes" : "Ver pedidos em aberto"} <Icon name="chevronRight" size={16} />
      </Link>
    </section>
  );
}
