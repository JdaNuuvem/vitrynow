"use client";

import "@/shared/ui/ui.css";
import { useCashier } from "@/features/caixa/hooks/useCashier";
import { CloseCashCard } from "./components/CloseCashCard";
import { MovementForm } from "./components/MovementForm";
import { MovementsList } from "./components/MovementsList";
import { OpenCashCard } from "./components/OpenCashCard";
import { SessionSummaryCard } from "./components/SessionSummaryCard";
import { StaleWarning } from "./components/StaleWarning";
import "./controlecaixa.css";

export function ControleCaixaPage() {
  const { state, open, close, addMovement } = useCashier();

  return (
    <main className="controlecaixa">
      <h1>Caixa</h1>

      {!state ? (
        <p className="controlecaixa__muted">Carregando...</p>
      ) : !state.session ? (
        <OpenCashCard onOpen={open} />
      ) : (
        <div className="controlecaixa__stack">
          {state.stale && <StaleWarning />}
          <SessionSummaryCard session={state.session} expectedBalanceCents={state.expectedBalanceCents} />
          <MovementForm onAdd={addMovement} />
          <MovementsList movements={state.session.movements} />
          <CloseCashCard expectedBalanceCents={state.expectedBalanceCents} onClose={close} />
        </div>
      )}
    </main>
  );
}
