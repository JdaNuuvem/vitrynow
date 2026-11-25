"use client";

import type { CashSession, CashSummary, PaymentBucket } from "@/core/domain/cashier";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { Modal } from "@/shared/ui/Modal";
import { PAYMENT_LABELS } from "../paymentLabels";
import { activeStoreTimezone, formatInStoreTimezone } from "@/shared/format/storeTime";

export type SummaryTab = "resumo" | "historico";

type CashSummaryModalProps = {
  open: boolean;
  session: CashSession | null;
  summary: CashSummary | null;
  tab: SummaryTab;
  onTabChange: (tab: SummaryTab) => void;
  onClose: () => void;
};

const PAYMENT_ORDER: PaymentBucket[] = ["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VR", "VA", "NAO_IDENTIFICADO"];

function formatDateTime(iso: string): string {
  return formatInStoreTimezone(iso, activeStoreTimezone(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`cash-row${bold ? " cash-row--bold" : ""}`}>
      <p>{label}</p>
      <p>{value}</p>
    </div>
  );
}

export function CashSummaryModal({ open, session, summary, tab, onTabChange, onClose }: CashSummaryModalProps) {
  if (!session || !summary) return null;

  const { sales } = summary;
  const itemsCents = sales.revenueCents - sales.deliveryFeeCents - sales.tipCents;
  const tally = (label: string, row: { count: number; revenueCents: number }) => (
    <Line label={label} value={`${row.count} | ${formatCents(row.revenueCents)}`} />
  );

  return (
    <Modal open={open} onClose={onClose} labelledBy="cash-summary-title" width={720}>
      <header className="cash-modal__header cash-modal__header--start">
        <button type="button" className="cash-icon-button" onClick={onClose} aria-label="Fechar">
          <Icon name="chevronLeft" size={20} />
        </button>
        <h4 id="cash-summary-title">Resumo parcial</h4>
      </header>
      <nav className="cash-tabs" role="tablist">
        {(["resumo", "historico"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-selected" : undefined} onClick={() => onTabChange(id)}>
            {id === "resumo" ? "Resumo" : "Histórico"}
          </button>
        ))}
      </nav>

      {tab === "resumo" ? (
        <div className="cash-modal__body cash-modal__body--report">
          <section>
            <h5>Resumo</h5>
            <Line label="Aberto" value={formatDateTime(session.openedAt)} />
            <div className="cash-modal__summary-title">
              <p>Movimentação do caixa:</p>
              <p>Saldo de abertura + vendas em dinheiro + entradas - saídas.</p>
            </div>
            <Line label="Saldo abertura:" value={formatCents(summary.openingCents)} />
            <Line label="Vendas em dinheiro:" value={formatCents(summary.cashSalesCents)} />
            <Line label="Entradas:" value={formatCents(summary.entriesCents)} />
            <Line label="Saídas:" value={formatCents(summary.exitsCents)} />
            <Line label="Em caixa esperado:" value={formatCents(summary.expectedCents)} bold />
          </section>
          <section>
            <div className="cash-modal__summary-title">
              <p>Faturamento</p>
              <p>Receita agrupada de todas as vendas desde a abertura do caixa</p>
            </div>
            <Line label="Vendas:" value={formatCents(itemsCents)} />
            <Line label="Taxas de entrega:" value={formatCents(sales.deliveryFeeCents)} />
            <Line label="Gorjetas:" value={formatCents(sales.tipCents)} />
            <Line label="Faturamento total:" value={formatCents(sales.revenueCents)} bold />
          </section>
          <section>
            <div className="cash-row cash-row--header">
              <h5>Vendas:</h5>
              <h5>Qtd | Receita</h5>
            </div>
            {tally("Entrega:", sales.byType.DELIVERY)}
            {tally("Retirada/Balcão:", sales.byType.BALCAO)}
            {tally("Mesa:", sales.byType.MESA)}
            {tally("Cancelados:", { count: sales.canceledCount, revenueCents: sales.canceledCents })}
            {tally("Total:", { count: sales.count, revenueCents: sales.revenueCents })}
          </section>
          <section>
            <div className="cash-row cash-row--header">
              <h5>Pagamentos:</h5>
            </div>
            {PAYMENT_ORDER.filter((bucket) => summary.byPaymentMethod[bucket]).map((bucket) => (
              <Line key={bucket} label={`${PAYMENT_LABELS[bucket]}:`} value={formatCents(summary.byPaymentMethod[bucket]!.revenueCents)} />
            ))}
            {Object.keys(summary.byPaymentMethod).length === 0 && <p className="cash-modal__muted">Nenhuma venda no período.</p>}
          </section>
        </div>
      ) : (
        <div className="cash-modal__body">
          <div className="cash-history__item">
            <p>
              {formatDateTime(session.openedAt)} · Abertura{session.openingNotes ? ` · ${session.openingNotes}` : ""}
            </p>
            <span>{formatCents(session.openingBalanceCents)}</span>
          </div>
          {session.movements.length === 0 && <p className="cash-modal__muted">Nenhuma movimentação registrada.</p>}
          {session.movements.map((movement) => (
            <div key={movement.id} className="cash-history__item">
              <p>
                {formatDateTime(movement.createdAt)} · {movement.type === "SUPRIMENTO" ? "Entrada" : "Saída"}
                {movement.notes ? ` · ${movement.notes}` : ""}
              </p>
              <span className={movement.type === "SANGRIA" ? "is-exit" : undefined}>
                {movement.type === "SANGRIA" ? "- " : ""}
                {formatCents(movement.amountCents)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
