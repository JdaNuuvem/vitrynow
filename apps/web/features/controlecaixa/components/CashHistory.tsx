"use client";

import { useCallback, useEffect, useState } from "react";
import type { CashClosedSession, CashSessionDetail } from "@/core/domain/cashier";
import { usePanelServices } from "@/core/services/PanelServices";
import { Button, DataTable, Panel, StateMessage } from "@/shared/design/components";
import { Modal } from "@/shared/ui/Modal";
import { formatCents } from "@/shared/format/money";
import { closeReasons } from "@/features/caixa/cashReasons";
import { MovementsList } from "./MovementsList";

const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const integer = new Intl.NumberFormat("pt-BR");

function historicalCents(value: number | string | null | undefined) {
  if (typeof value === "number") return formatCents(value);
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return "—";
  const negative = value.startsWith("-");
  const magnitude = (negative ? value.slice(1) : value).padStart(3, "0");
  return (negative ? "−" : "") + "R$ " + integer.format(BigInt(magnitude.slice(0, -2))) + "," + magnitude.slice(-2);
}

type Detail = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: CashSessionDetail };

export function CashHistory() {
  const { cashier } = usePanelServices();
  const [sessions, setSessions] = useState<CashClosedSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<CashClosedSession | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    cashier.listClosed().then((result) => {
      if (!active) return;
      if (result.ok) { setSessions(result.data.sessions); setError(null); }
      else { if ([401, 403].includes(result.status)) setSessions(null); setError(result.error); }
    });
    return () => { active = false; };
  }, [cashier, attempt]);

  useEffect(() => {
    if (!selection) return;
    let active = true;
    setDetail({ status: "loading" });
    cashier.closedDetail(selection.id).then((result) => {
      if (active) setDetail(result.ok ? { status: "ready", data: result.data } : { status: "error", message: result.error });
    });
    return () => { active = false; };
  }, [cashier, selection, attempt]);

  const showClosingAmounts = sessions?.some((session) => session.closingBalanceCents !== undefined) ?? false;
  const current = detail?.status === "ready" ? detail.data : null;
  return (
    <Panel title="Caixas fechados" actions={<Button icon="clock" onClick={reload}>Atualizar</Button>}>
      {error && <StateMessage tone="danger" title="Não foi possível carregar o histórico" action={<Button onClick={reload}>Tentar novamente</Button>}>{error}</StateMessage>}
      {!sessions && !error && <StateMessage title="Consultando caixas fechados…" busy />}
      {sessions?.length === 0 && <StateMessage title="Nenhum caixa fechado." />}
      {!!sessions?.length && (
        <DataTable label="Histórico de caixas" headers={["Abertura", "Fechamento", "Saldo inicial", ...(showClosingAmounts ? ["Valor contado", "Diferença"] : []), "Detalhes"]}>
          {sessions.map((session) => <tr key={session.id}>
            <td>{date.format(new Date(session.openedAt))}</td><td>{date.format(new Date(session.closedAt))}</td>
            <td>{historicalCents(session.openingBalanceCents)}</td>
            {showClosingAmounts && <><td>{historicalCents(session.closingBalanceCents)}</td><td>{historicalCents(session.differenceCents)}</td></>}
            <td><Button variant="quiet" onClick={() => { setDetail(null); setSelection(session); }}>Ver detalhes</Button></td>
          </tr>)}
        </DataTable>
      )}
      <Modal open={selection !== null} onClose={() => setSelection(null)} labelledBy="closed-cash-title" width={540} sheetOnMobile>
        <div className="closed-cash">
          <h2 id="closed-cash-title">Detalhes do caixa fechado</h2>
          {(!detail || detail.status === "loading") && <StateMessage title="Carregando detalhes…" busy />}
          {detail?.status === "error" && <StateMessage tone="danger" title="Não foi possível abrir o caixa" action={<Button onClick={reload}>Tentar novamente</Button>}>{detail.message}</StateMessage>}
          {current && <>
            <dl className="cash-edit__preview">
              <div><dt>Abertura</dt><dd>{date.format(new Date(current.session.openedAt))}</dd></div>
              <div><dt>Fechamento</dt><dd>{date.format(new Date(current.session.closedAt))}</dd></div>
              <div><dt>Saldo inicial</dt><dd>{historicalCents(current.session.openingBalanceCents)}</dd></div>
              {current.session.closedByRole && <div><dt>Fechado por</dt><dd>{current.session.closedByRole === "OWNER" ? "Dono" : "Funcionário"}</dd></div>}
              {current.summary && <>
                <div><dt>Esperado</dt><dd>{historicalCents(current.session.expectedClosingCents ?? current.summary.expectedCents)}</dd></div>
                <div><dt>Contado</dt><dd>{historicalCents(current.session.closingBalanceCents)}</dd></div>
                <div><dt>Diferença</dt><dd>{historicalCents(current.session.differenceCents)}</dd></div>
                {current.session.closeReason && <div><dt>Motivo</dt><dd>{current.session.closeReasonText || closeReasons.find(([key]) => key === current.session.closeReason)?.[1] || current.session.closeReason}</dd></div>}
              </>}
            </dl>
            {current.session.movements && <MovementsList movements={current.session.movements} />}
          </>}
          <Button onClick={() => setSelection(null)}>Voltar</Button>
        </div>
      </Modal>
    </Panel>
  );
}
