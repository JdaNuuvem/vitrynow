"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelServices } from "@/core/services/PanelServices";
import { operationRequest } from "@/features/operacao/storeOperations";
import type { FloorElement, SalaoTable, TableAccount } from "./types";

// SALÃO 3D — dados reais: GET /api/tables (status calculado na API) + GET /api/floor (elementos). Atualiza sozinho pelo tempo real
// (order.*, table.alert, table.updated). A atualização troca só o objeto da mesa que mudou; o 3D re-renderiza só aquela mesa.
export function useSalao() {
  const { realtime } = usePanelServices();
  const [tables, setTables] = useState<SalaoTable[] | null>(null);
  const [elements, setElements] = useState<FloorElement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const version = useRef(0);

  const reloadTables = useCallback(async () => {
    const current = ++version.current;
    const result = await operationRequest<{ tables: SalaoTable[] }>("/api/tables");
    if (current !== version.current) return;
    if (!result.ok) return setError(result.error);
    setError(null);
    // mantém a MESMA referência das mesas que não mudaram (o memo do 3D evita redesenhá-las)
    setTables((prev) => {
      const old = new Map((prev ?? []).map((t) => [t.id, t]));
      return result.data.tables.map((t) => {
        const before = old.get(t.id);
        return before && JSON.stringify(before) === JSON.stringify(t) ? before : t;
      });
    });
  }, []);

  const reloadFloor = useCallback(async () => {
    const result = await operationRequest<{ elements: FloorElement[] }>("/api/floor");
    if (!result.ok) {
      if (result.status === 402) setLocked(true);
      else setError(result.error);
      return;
    }
    setElements(result.data.elements);
  }, []);

  useEffect(() => {
    void reloadTables();
    void reloadFloor();
    const stop = realtime.subscribe((event) => {
      const type = event?.type ?? "";
      if (type.startsWith("order.") || type === "table.alert" || type === "table.updated") void reloadTables();
      if (type === "table.updated" && (event as { tableId?: string }).tableId === "*") void reloadFloor();
    });
    // o "há X min" envelhece mesmo sem evento
    const timer = window.setInterval(() => void reloadTables(), 60_000);
    return () => {
      version.current += 1;
      stop();
      window.clearInterval(timer);
    };
  }, [realtime, reloadTables, reloadFloor]);

  return { tables, setTables, elements, setElements, error, locked, reloadTables, reloadFloor };
}

export async function loadAccount(tableId: string) {
  return operationRequest<TableAccount>(`/api/tables/${encodeURIComponent(tableId)}/account`);
}

export async function clearAlert(tableId: string, kind: "CALL_WAITER" | "ASK_BILL" | "ALL") {
  return operationRequest<{ ok: true }>(`/api/tables/${encodeURIComponent(tableId)}/alerts/clear`, "POST", { kind });
}

export async function saveFloor(tables: SalaoTable[], elements: FloorElement[]) {
  return operationRequest<{ ok: true }>("/api/floor", "PUT", {
    tables: tables.map((t) => ({ id: t.id, ...t.layout })),
    elements: elements.map(({ id: _id, ...e }) => ({ ...e, area: e.area ?? null })),
  });
}
