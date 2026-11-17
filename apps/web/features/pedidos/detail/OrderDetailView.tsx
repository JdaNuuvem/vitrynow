"use client";

import { useEffect, useRef, useState } from "react";
import { statusLabel, TYPE_LABELS } from "@/core/domain/orderLabels";
import type { OrderDetail } from "@/core/domain/orderDetail";
import type { Deliverer, Order } from "@/core/domain/orders";
import { formatCents } from "@/shared/format/money";
import { CANCEL_REASONS } from "../cancelReasons";
import type { CardAction } from "../orderActions";
import { ageText, orderAgeMinutes } from "../orderAge";
import { OrderActions } from "../components/OrderActions";
import { paymentBadges } from "../components/OrderCard";
import { actorText, canContact, mapsHref, paymentView, telHref, valueRows, whatsappHref } from "./detailFormat";

const STORE_TIMEZONE = "America/Sao_Paulo";
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: STORE_TIMEZONE });
const reasonLabel = (code: string | null) => CANCEL_REASONS.find((reason) => reason.code === code)?.label ?? null;

export type DetailHandlers = {
  onAdvance: (order: Order, action: CardAction) => void;
  onOpenCancel: (order: Order, action: CardAction) => void;
  onUndo: (order: Order) => void;
  onRetryRefund: (order: Order) => void;
  onAssignDeliverer: (order: Order, delivererId: string) => void;
};

type Props = {
  order: OrderDetail;
  // Busca o pedido de novo (o aviso "contato indisponível" tem "Tentar de novo")
  onRetryContact: () => void;
  // A busca do "Tentar de novo" está em andamento
  retryingContact?: boolean;
  deliverers: Deliverer[];
  nowMs: number;
  busy: boolean;
  canRetryRefund: boolean;
} & DetailHandlers;

// Conteúdo do detalhe (spec 11 §3), na ordem fixa: cliente, entrega, observação, itens, valores, pagamento, entregador,
// impressão, cancelamento. O servidor decide o que cada papel recebe; aqui só se mostra o que chegou.
export function OrderDetailView({ order, deliverers, nowMs, busy, canRetryRefund, onRetryContact, retryingContact = false, ...handlers }: Props) {
  const [copied, setCopied] = useState(false);
  const [contactLoaded, setContactLoaded] = useState(false);
  const retryButton = useRef<HTMLButtonElement>(null);
  const clientTitle = useRef<HTMLHeadingElement>(null);
  const wasRetrying = useRef(false);
  const minutes = orderAgeMinutes(order, nowMs);
  const age = ageText(minutes);
  const badges = paymentBadges(order);
  const payment = paymentView(order);
  const selectable = deliverers.filter((deliverer) => deliverer.active || deliverer.id === order.delivererId);
  const isDelivery = order.type === "DELIVERY";
  const contact = canContact(order);
  const contactUnavailable = order.contactUnavailable === "AUDIT_UNAVAILABLE";

  // Depois de "Tentar de novo" (spec 11 §12): sucesso leva o foco ao título do bloco Cliente e anuncia "Contato
  // carregado."; falha repetida mantém a faixa e devolve o foco ao botão. Nunca há nova tentativa automática.
  useEffect(() => {
    if (wasRetrying.current && !retryingContact) {
      if (contactUnavailable) retryButton.current?.focus();
      else {
        clientTitle.current?.focus();
        setContactLoaded(true);
      }
    }
    wasRetrying.current = retryingContact;
  }, [retryingContact, contactUnavailable]);

  async function copyAddress() {
    if (!order.address) return;
    try {
      await navigator.clipboard.writeText(order.address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="pedido-detalhe">
      <div className="pedido-detalhe__chips">
        <span className="pedidos-card__chip">{statusLabel(order.status)}</span>
        <span>{TYPE_LABELS[order.type] ?? order.type}</span>
        {age && <span>{age}</span>}
        {badges.map((badge) => (
          <span key={badge.text} className={`pedidos-card__badge pedidos-card__badge--${badge.tone}`}>
            {badge.text}
          </span>
        ))}
        {!order.printedAt && order.status !== "CANCELADO" && <span className="pedidos-card__badge pedidos-card__badge--warn">Não impresso</span>}
      </div>

      <section aria-labelledby="det-cliente">
        <h3 id="det-cliente" ref={clientTitle} tabIndex={-1}>
          Cliente
        </h3>
        <p className="pedido-detalhe__strong">{order.customerName ?? "Cliente não informado"}</p>
        {order.hasPhone && (
          <p className="pedido-detalhe__phone">{order.customerPhone}</p>
        )}
        {contact && order.customerPhone && (
          <div className="pedido-detalhe__row">
            <a className="pedido-detalhe__action" href={telHref(order.customerPhone)} aria-label={`Ligar para ${order.customerName ?? "o cliente"}`}>
              Ligar
            </a>
            {/* Abre o WhatsApp fora do app com o texto "Pedido #código" e mais nada: nada é enviado por esta tela. */}
            <a className="pedido-detalhe__action" href={whatsappHref(order.customerPhone, order.code)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir o WhatsApp de ${order.customerName ?? "o cliente"} (abre em outra aba)`}>
              WhatsApp
            </a>
          </div>
        )}
        {contactUnavailable && (
          // Falha fechada do servidor (API-54b): não foi possível registrar o acesso, então o contato não veio. Não é
          // erro de papel nem falha geral: é um bloqueio temporário. O resto do pedido segue na tela.
          <div role="status" className="pedido-detalhe__alert">
            <span>
              <span aria-hidden="true">🔒 </span>Contato indisponível agora. Tente de novo.
            </span>
            <button
              ref={retryButton}
              type="button"
              className="pedido-detalhe__action"
              aria-disabled={retryingContact || undefined}
              onClick={() => {
                if (!retryingContact) onRetryContact();
              }}
            >
              {retryingContact ? "Tentando…" : "Tentar de novo"}
            </button>
          </div>
        )}
        <p role="status" className="pedido-detalhe__visually-hidden">
          {contactLoaded ? "Contato carregado." : ""}
        </p>
        {!contactUnavailable && order.hasPhone && order.contactMasked && <p className="pedido-detalhe__help">Contato protegido. Peça ao dono para ver o número.</p>}
      </section>

      {isDelivery && (
        <section aria-labelledby="det-entrega">
          <h3 id="det-entrega">Entrega</h3>
          {order.address ? (
            <>
              <p className="pedido-detalhe__address">{order.address}</p>
              <div className="pedido-detalhe__row">
                <button type="button" className="pedido-detalhe__action" onClick={copyAddress}>
                  Copiar endereço
                </button>
                <a className="pedido-detalhe__action" href={mapsHref(order.address)} target="_blank" rel="noopener noreferrer" aria-label="Abrir o endereço no mapa (abre em outra aba)">
                  Abrir no mapa ↗
                </a>
              </div>
              <p className="pedido-detalhe__help">Abre um serviço de mapas externo.</p>
              <p role="status" className="pedido-detalhe__help">
                {copied ? "Endereço copiado" : ""}
              </p>
            </>
          ) : order.hasAddress ? (
            <p className="pedido-detalhe__help">{contactUnavailable ? "Endereço indisponível agora." : "Endereço protegido. Peça ao dono para ver."}</p>
          ) : (
            <p className="pedido-detalhe__help">Endereço não informado.</p>
          )}
        </section>
      )}

      {order.notes && (
        <section aria-labelledby="det-obs" className="pedido-detalhe__warn">
          <h3 id="det-obs">
            <span aria-hidden="true">⚠ </span>Observação do cliente
          </h3>
          {/* Inteira, nunca cortada: pode ser alergia ou restrição (CA-DET-13). */}
          <p className="pedido-detalhe__notes">{order.notes}</p>
        </section>
      )}

      <section aria-labelledby="det-itens">
        <h3 id="det-itens">Itens</h3>
        <ul className="pedido-detalhe__items">
          {order.items.map((item) => (
            <li key={item.id}>
              <span>
                {item.quantity}× {item.productName}
              </span>
              <span>{formatCents(item.unitPriceCents * item.quantity)}</span>
              {item.notes && <span className="pedido-detalhe__item-note">Obs.: {item.notes}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="det-valores">
        <h3 id="det-valores">Valores</h3>
        <dl className="pedido-detalhe__values">
          {valueRows(order).map((row) => (
            <div key={row.label} className={row.label === "Total" ? "is-total" : undefined}>
              <dt>
                {row.label}
                {row.note && <small> ({row.note})</small>}
              </dt>
              <dd>
                {row.sign === "minus" ? "− " : ""}
                {formatCents(row.cents)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="det-pagamento">
        <h3 id="det-pagamento">Pagamento</h3>
        {payment.lines.map((line) => (
          <p key={line} className="pedido-detalhe__strong">
            {line}
          </p>
        ))}
        {payment.highlight && <p className="pedido-detalhe__change">{payment.highlight}</p>}
      </section>

      {isDelivery && (
        <section aria-labelledby="det-entregador">
          <h3 id="det-entregador">Entregador</h3>
          <select
            className="pedido-detalhe__select"
            aria-labelledby="det-entregador"
            value={order.delivererId ?? ""}
            onChange={(event) => handlers.onAssignDeliverer(order, event.target.value)}
          >
            <option value="">Sem entregador / eu mesmo</option>
            {selectable.map((deliverer) => (
              <option key={deliverer.id} value={deliverer.id}>
                {deliverer.name}
              </option>
            ))}
          </select>
        </section>
      )}

      <section aria-labelledby="det-impressao">
        <h3 id="det-impressao">Impressão</h3>
        <p>{order.printedAt ? `Impresso às ${timeOf(order.printedAt)}` : "Ainda não impresso"}</p>
      </section>

      {order.cancel && (
        <section aria-labelledby="det-cancel">
          <h3 id="det-cancel">Cancelamento</h3>
          <p>
            {actorText(order.cancel.by)[0].toUpperCase() + actorText(order.cancel.by).slice(1)} às {timeOf(order.cancel.at)}
          </p>
          {/* Duas linhas separadas: o motivo interno (só a loja vê) e a frase que o cliente viu (CA-DET-11). */}
          {(reasonLabel(order.cancel.reasonCode) || order.cancel.reasonText) && (
            <p>
              Motivo (só a loja vê): {reasonLabel(order.cancel.reasonCode) ?? order.cancel.reasonText}
              {reasonLabel(order.cancel.reasonCode) && order.cancel.reasonText ? ` · ${order.cancel.reasonText}` : ""}
            </p>
          )}
          {order.cancel.customerMessage && <p>O cliente viu: “{order.cancel.customerMessage}”</p>}
        </section>
      )}

      <div className="pedido-detalhe__footer">
        <OrderActions
          order={order}
          busy={busy}
          canRetryRefund={canRetryRefund}
          onAdvance={handlers.onAdvance}
          onOpenCancel={handlers.onOpenCancel}
          onUndo={handlers.onUndo}
          onRetryRefund={handlers.onRetryRefund}
        />
      </div>
    </div>
  );
}
