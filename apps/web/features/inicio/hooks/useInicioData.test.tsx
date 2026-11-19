import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PanelServicesProvider, type PanelServices } from "@/core/services/PanelServices";
import { useInicioData } from "./useInicioData";

describe("filas da visão geral", () => {
  it("isola os erros e descarta o último total quando o servidor revoga o acesso", async () => {
    let waitingStatus = 200;
    const history = vi.fn().mockResolvedValue({ ok: true, data: { total: 7, rows: [], period: null, nextCursor: null, timezone: "America/Sao_Paulo" } });
    const awaitingPayments = vi.fn(async () => waitingStatus === 200
      ? { ok: true, data: { count: 2, orders: [] } }
      : { ok: false, status: waitingStatus, error: "Falha" });
    const services = {
      orders: { history, awaitingPayments },
      reports: { getSummary: vi.fn().mockRejectedValue(new Error("Sem conexão")) },
    } as unknown as PanelServices;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PanelServicesProvider services={services}>{children}</PanelServicesProvider>
    );
    const { result } = renderHook(() => useInicioData(), { wrapper });
    await waitFor(() => expect(result.current.waiting.data?.count).toBe(2));
    expect(result.current.month.data).toBeNull();
    expect(result.current.month.error).toBeTruthy();
    expect(result.current.open.data?.total).toBe(7);
    expect(history).toHaveBeenCalledWith({ status: "ABERTO", limit: 4 });
    expect(awaitingPayments).toHaveBeenCalledTimes(1);

    waitingStatus = 500;
    act(() => result.current.waiting.retry());
    await waitFor(() => expect(result.current.waiting.error).toBeTruthy());
    expect(result.current.waiting.data?.count).toBe(2);
    expect(result.current.waiting.updatedAt).toBeInstanceOf(Date);

    waitingStatus = 403;
    act(() => result.current.waiting.retry());
    await waitFor(() => expect(result.current.waiting.data).toBeNull());
    expect(result.current.waiting.updatedAt).toBeNull();
    expect(result.current.open.data?.total).toBe(7);
  });
});
