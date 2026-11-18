import Link from "next/link";
import { STATUS_LABELS, TYPE_LABELS } from "@/core/domain/orderLabels";
import type { Order } from "@/core/domain/orders";
import { formatCents } from "@/shared/format/money";
import { Shine } from "@/shared/ui/Shine";

export function CurrentOrdersCard({ orders, ordersHref }: { orders: Order[] | null; ordersHref: string }) {
  return (
    <div className="inicio-card inicio-current">
      <p className="inicio-card__title">Pedidos em andamento</p>
      <div className="inicio-current__header">
        {orders === null ? <Shine width={52} height={32} /> : <p>{orders.length}</p>}
        <Link href={ordersHref}>Acessar painel</Link>
      </div>
      {orders === null && <Shine height={170} />}
      {orders?.length === 0 && <p className="inicio-muted">Nenhum pedido em andamento agora.</p>}
      <div className="inicio-current__list">
        {orders?.map((order) => (
          <Link key={order.id} href={ordersHref} className="inicio-order">
            <div className="inicio-order__top">
              <strong>#{order.code}</strong>
              <span>{TYPE_LABELS[order.type]}</span>
              <span className="inicio-order__status">{STATUS_LABELS[order.status]}</span>
            </div>
            <p>{order.customerName ?? "Cliente não informado"}</p>
            <p className="inicio-order__items">{order.items.map((item) => `${item.quantity}x ${item.productName}`).join(", ")}</p>
            <p className="inicio-order__total">{formatCents(order.totalCents)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
