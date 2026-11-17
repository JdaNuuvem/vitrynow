import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryQuery, HistoryRow } from "@/core/domain/orderHistory";
import type { HttpResult } from "@/core/http/HttpClient";
import { PanelServicesProvider, type PanelServices } from "@/core/services/PanelServices";
import { useOrderHistoryList } from "./useOrderHistoryList";

const push = vi.fn();
const router = { push }; // ESTÁVEL, como o roteador real
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const ok = <T,>(data: T): HttpResult<T> => ({ ok: true, data });
const fail = (status: number, error = "x"): HttpResult<never> => ({ ok: false, status, error });
const row = (id: string, over: Partial<HistoryRow> = {}): HistoryRow => ({
  id,
  code: id.padStart(4, "0"),
  createdAt: "2026-11-10T12:00:00Z",
  customerName: "Ana",
  customerPhone: "(11) ••••-5678",
  hasPhone: true,
  type: "BALCAO",
  totalCents: 1000,
  status: "PENDENTE",
  display: "ABERTO",
  paymentMethod: null,
  paymentStatus: null,
  refundPending: false,
  notPrinted: false,
  ...over,
});
const page = (rows: HistoryRow[], total = rows.length, nextCursor: string | null = null) => ok({ rows, total, nextCursor, period: { from: "a", to: "b" }, timezone: "America/Sao_Paulo" });

const QUERY: HistoryQuery = { status: "ABERTO", period: "custom", from: "2026-08-20", to: "2026-11-17" };

function setup(history: ReturnType<typeof vi.fn>, query: HistoryQuery = QUERY) {
  const services = { orders: { history } } as unknown as PanelServices;
  const wrapper = ({ children }: { children: ReactNode }) => <PanelServicesProvider services={services}>{children}</PanelServicesProvider>;
  return renderHook(({ q }) => useOrderHistoryList(q), { wrapper, initialProps: { q: query } });
}

beforeEach(() => push.mockClear());

describe("useOrderHistoryList: carga", () => {
  it("começa 'loading' e vira 'ready' com as linhas, o total e o fuso da loja", async () => {
    const history = vi.fn().mockResolvedValue(page([row("1"), row("2")], 2));
    const { result } = setup(history);
    expect(result.current.loadState).toBe("loading");
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(result.current.total).toBe(2);
    expect(result.current.timezone).toBe("America/Sao_Paulo");
    expect(result.current.hasMore).toBe(false);
  });

  it("pede a situação ABERTO, o período de 90 dias e 25 por página", async () => {
    const history = vi.fn().mockResolvedValue(page([]));
    setup(history);
    await waitFor(() => expect(history).toHaveBeenCalled());
    expect(history).toHaveBeenCalledWith({ status: "ABERTO", period: "custom", from: "2026-08-20", to: "2026-11-17", limit: 25 });
  });

  it("falha na 1ª carga vira 'error' e 'Tentar de novo' busca de novo", async () => {
    const history = vi.fn().mockResolvedValueOnce(fail(500)).mockResolvedValue(page([row("1")]));
    const { result } = setup(history);
    await waitFor(() => expect(result.current.loadState).toBe("error"));
    expect(result.current.rows).toEqual([]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.rows).toHaveLength(1);
  });

  it("401 manda para o login e não mostra erro", async () => {
    const { result } = setup(vi.fn().mockResolvedValue(fail(401)));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(result.current.rateLimited).toBe(false);
  });

  it("429 na 1ª carga marca o limite de buscas", async () => {
    const { result } = setup(vi.fn().mockResolvedValue(fail(429)));
    await waitFor(() => expect(result.current.loadState).toBe("error"));
    expect(result.current.rateLimited).toBe(true);
  });
});

describe("useOrderHistoryList: 'Carregar mais' com cursor (CA-HP-04)", () => {
  it("manda o cursor, soma as linhas novas e para quando não há mais", async () => {
    const history = vi
      .fn()
      .mockResolvedValueOnce(page([row("1"), row("2")], 3, "CUR1"))
      .mockResolvedValueOnce(page([row("3")], 3, null));
    const { result } = setup(history);
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => result.current.loadMore());
    expect(history).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "CUR1", limit: 25 }));
    expect(result.current.rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(result.current.hasMore).toBe(false);
  });

  it("uma linha que já está na lista NÃO entra de novo (sem repetir)", async () => {
    const history = vi.fn().mockResolvedValueOnce(page([row("1"), row("2")], 3, "C")).mockResolvedValueOnce(page([row("2"), row("3")], 3, null));
    const { result } = setup(history);
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => result.current.loadMore());
    expect(result.current.rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("falha ao carregar mais mantém a lista e avisa, e dá para tentar de novo", async () => {
    const history = vi.fn().mockResolvedValueOnce(page([row("1")], 2, "C")).mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(page([row("2")], 2, null));
    const { result } = setup(history);
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => result.current.loadMore());
    expect(result.current.moreFailed).toBe(true);
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.hasMore).toBe(true);
    await act(async () => result.current.loadMore());
    expect(result.current.moreFailed).toBe(false);
    expect(result.current.rows).toHaveLength(2);
  });

  it("dois toques seguidos em 'Carregar mais' não pedem duas vezes a mesma página", async () => {
    let release: (value: HttpResult<unknown>) => void = () => {};
    const history = vi
      .fn()
      .mockResolvedValueOnce(page([row("1")], 3, "C"))
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve as typeof release)));
    const { result } = setup(history);
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    expect(history).toHaveBeenCalledTimes(2); // 1ª carga + UMA página extra
    await act(async () => release(page([row("2")], 3, null)));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
  });
});

describe("useOrderHistoryList: recarga depois de uma ação", () => {
  it("refresh busca de novo SEM voltar para 'loading' e troca a lista", async () => {
    const history = vi.fn().mockResolvedValueOnce(page([row("1"), row("2")], 2)).mockResolvedValueOnce(page([row("2")], 1));
    const { result } = setup(history);
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    act(() => result.current.refresh());
    expect(result.current.loadState).toBe("ready"); // nunca pisca "carregando" no meio da operação
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["2"]));
  });

  it("recarga que falha DEPOIS de já mostrar a lista mantém a lista e o estado", async () => {
    const history = vi.fn().mockResolvedValueOnce(page([row("1")], 1)).mockResolvedValue(fail(500));
    const { result } = setup(history);
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    await act(async () => result.current.refresh());
    expect(result.current.loadState).toBe("ready");
    expect(result.current.rows).toHaveLength(1);
  });

  it("uma resposta que ficou velha (a consulta mudou) é descartada", async () => {
    let releaseOld: (value: HttpResult<unknown>) => void = () => {};
    const history = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve as typeof releaseOld)))
      .mockResolvedValue(page([row("9")], 1));
    const { result, rerender } = setup(history);
    rerender({ q: { ...QUERY, to: "2026-11-18" } });
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(["9"]));
    await act(async () => releaseOld(page([row("OLD")], 1)));
    expect(result.current.rows.map((r) => r.id)).toEqual(["9"]);
  });
});
