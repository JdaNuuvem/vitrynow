"use client";

import Link from "next/link";
import { useState } from "react";
import type { CashMovementType } from "@/core/domain/cashier";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { StateMessage } from "@/shared/design/components";
import { CashConfigModal } from "./components/CashConfigModal";
import { CashSummaryModal, type SummaryTab } from "./components/CashSummaryModal";
import { CloseCashModal } from "./components/CloseCashModal";
import { MovementModal } from "./components/MovementModal";
import { OpenCashModal } from "./components/OpenCashModal";
import { useCashier } from "./hooks/useCashier";
import "./caixa.css";
import { activeStoreTimezone, formatInStoreTimezone } from "@/shared/format/storeTime";

type ActiveModal = "open" | "close" | "summary" | "config" | null;

function openedAtLabel(iso: string): string {
  return `Aberto às ${formatInStoreTimezone(iso, activeStoreTimezone(), { hour: "2-digit", minute: "2-digit" })}`;
}

export function CaixaWidget({ reportsHref }: { reportsHref: string }) {
  const { state, open, close, addMovement, previewClose, lastClosing } = useCashier();
  const [modal, setModal] = useState<ActiveModal>(null);
  const [movementType, setMovementType] = useState<CashMovementType | null>(null);
  const [summaryTab, setSummaryTab] = useState<SummaryTab>("resumo");

  const session = state?.session ?? null;
  const summary = state?.summary ?? null;
  const closeModal = () => setModal(null);

  function showSummary(tab: SummaryTab) {
    setSummaryTab(tab);
    setModal("summary");
  }

  if (!state) return null;

  return (
    <>
      <section className="caixa-widget">
        <div className="caixa-widget__header">
          <div className={`caixa-widget__status${session ? " is-open" : ""}`}>
            {session && <span className="caixa-widget__dot" />}
            <h4>{session ? "Caixa aberto" : "Caixa fechado"}</h4>
          </div>
          {session && <p className="caixa-widget__since">{openedAtLabel(session.openedAt)}</p>}
        </div>

        {session ? (
          <div className="caixa-widget__content">
            <div className="caixa-widget__info">
              <p>Em caixa</p>
              <p>{formatCents(state.expectedBalanceCents)}</p>
            </div>
            {state.stale && <p className="caixa-widget__stale">Aberto há mais de 20h. Considere fechar o caixa.</p>}
            <div className="caixa-widget__row">
              <button type="button" className="is-entry" onClick={() => setMovementType("SUPRIMENTO")}>
                Entrada
              </button>
              <button type="button" className="is-exit" onClick={() => setMovementType("SANGRIA")}>
                Saída
              </button>
            </div>
            <button type="button" className="caixa-widget__neutral" onClick={() => showSummary("resumo")}>
              Resumo
            </button>
            <button type="button" className="caixa-widget__neutral" onClick={() => setModal("close")}>
              Fechar caixa
            </button>
          </div>
        ) : (
          <div className="caixa-widget__content">
            <button type="button" className="caixa-widget__open" onClick={() => setModal("open")}>
              Abrir caixa
            </button>
            <Link href={reportsHref} className="caixa-widget__neutral">
              Ver relatórios
            </Link>
            <button type="button" className="caixa-widget__config" onClick={() => setModal("config")}>
              <Icon name="settings" size={16} />
              <span>Ajuda com o caixa</span>
            </button>
            {lastClosing && <StateMessage tone="success" title="Caixa fechado." />}
          </div>
        )}
      </section>

      <OpenCashModal open={modal === "open"} onClose={closeModal} onConfirm={open} />
      <MovementModal type={movementType} onClose={() => setMovementType(null)} onConfirm={addMovement} />
      <CloseCashModal
        open={modal === "close"}
        onClose={closeModal}
        onPreview={previewClose}
        onConfirm={close}
      />
      <CashSummaryModal open={modal === "summary"} session={session} summary={summary} tab={summaryTab} onTabChange={setSummaryTab} onClose={closeModal} />
      <CashConfigModal open={modal === "config"} onClose={closeModal} />
    </>
  );
}
