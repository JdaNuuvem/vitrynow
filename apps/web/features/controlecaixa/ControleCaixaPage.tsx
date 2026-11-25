"use client";

import "@/shared/ui/ui.css";
import { useState } from "react";
import Link from "next/link";
import { formatCents } from "@/shared/format/money";
import { Button, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { Tabs } from "@/shared/design/Tabs";
import { useCashier } from "@/features/caixa/hooks/useCashier";
import { CashCloseEditor, CashMovementEditor } from "@/features/caixa/components/CashEditors";
import { CashHistory } from "./components/CashHistory";
import { WithdrawalLimit } from "./components/WithdrawalLimit";
import { MovementsList } from "./components/MovementsList";
import { OpenCashCard } from "./components/OpenCashCard";
import { SessionSummaryCard } from "./components/SessionSummaryCard";
import { StaleWarning } from "./components/StaleWarning";
import "./controlecaixa.css";

export function ControleCaixaPage() {
  const { state, error, reload, open, close, addMovement, previewClose, lastClosing, dismissClosing, dismissRuleNotice } = useCashier();
  const [tab, setTab] = useState<"operacao" | "historico">("operacao");
  const [noticeError, setNoticeError] = useState<string | null>(null);

  return (
    <main className="controlecaixa">
      <PageHeading title="Caixa" description={state && <StatusBadge tone={state.session ? "success" : "neutral"}>{state.session ? "Caixa aberto" : "Caixa fechado"}</StatusBadge>}
        actions={<Link href="/dashboard/relatorios" className="ds-button ds-button--secondary">Ver relatórios</Link>} />
      <Tabs label="Caixa" selected={tab} onSelect={setTab} items={[{ id: "operacao", label: "Operação" }, { id: "historico", label: "Histórico" }]}>
        {tab === "historico" ? <CashHistory /> : (
          <div className="controlecaixa__stack">
            {error && <StateMessage tone="danger" title="Não foi possível atualizar o caixa" action={<Button onClick={reload}>Tentar novamente</Button>}>{error}</StateMessage>}
            {!state && !error && <StateMessage title="Carregando caixa…" busy />}
            {lastClosing && <StateMessage tone="success" title="Caixa fechado" action={<Button onClick={dismissClosing}>Dispensar</Button>}>
              {lastClosing.differenceCents === 0 ? "O valor contado corresponde ao esperado." : (lastClosing.differenceCents > 0 ? "Sobrou " : "Faltou ") + formatCents(Math.abs(lastClosing.differenceCents))}
            </StateMessage>}
            {state?.ruleChangeNotice && <StateMessage tone="info" title={state.ruleChangeNotice.text} action={<Button onClick={async () => {
              setNoticeError(await dismissRuleNotice(state.ruleChangeNotice!.id));
            }}>Dispensar</Button>} />}
            {noticeError && <StateMessage tone="danger" title={noticeError} />}
            {state && (!state.session ? <OpenCashCard onOpen={open} /> : (
              <>
                {state.stale && <StaleWarning />}
                <SessionSummaryCard session={state.session} expectedBalanceCents={state.expectedBalanceCents} />
                <div className="controlecaixa__forms">
                  <Panel title="Nova movimentação"><CashMovementEditor key={state.session.id} onConfirm={addMovement} /></Panel>
                  <Panel title="Fechamento"><CashCloseEditor key={state.session.id} onPreview={previewClose} onConfirm={close} /></Panel>
                </div>
                <MovementsList movements={state.session.movements} />
              </>
            ))}
            {state?.staffWithdrawalLimitCents !== undefined && <WithdrawalLimit currentCents={state.staffWithdrawalLimitCents} onSaved={reload} />}
          </div>
        )}
      </Tabs>
    </main>
  );
}
