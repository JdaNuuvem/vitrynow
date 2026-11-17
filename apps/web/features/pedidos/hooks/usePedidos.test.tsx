import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/core/domain/orders";
import type { HttpResult } from "@/core/http/HttpClient";
import { PanelServicesProvider, type PanelServices } from "@/core/services/PanelServices";
import type { CardAction } from "../orderActions";
import { usePedidos } from "./usePedidos";

const push = vi.fn();
// Objeto ESTÁVEL, como o roteador real: um novo a cada render refaria o `reload` em loop.
const router = { push };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// runProtected real faz o passo de MFA; aqui basta repassar a ação, e provar que ela é chamada.
const runProtected = vi.fn(async (_purpose: string, action: (options?: unknown) => Promise<HttpResult<unknown>>) => action({ headers: { "x-mfa-challenge": "ok" } }));
vi.mock("@/features/seguranca/SecurityConfirmProvider", () => ({ useSecurityConfirm: () => ({ runProtected }) }));

const ok = <T,>(data: T): HttpResult<T> => ({ ok: true, data });
const fail = (status: number, error: string, code?: string): HttpResult<never> => ({ ok: false, status, error, code });

const order = (over: Partial<Order> = {}): Order =>
  ({ id: "o1", code: "0123", type: "BALCAO", status: "PENDENTE", customerName: "Ana", totalCents: 6900, items: [], delivererId: null, payment: null, ...over }) as Order;

const action = (over: Partial<CardAction> = {}): CardAction => ({ to: "CONFIRMADO", label: "Aceitar", kind: "ADVANCE", primary: true, requiresReason: false, refund: false, disabledReason: null, ...over });

function setup(gateway: Record<string, unknown> = {}) {
  const orders = {
    list: vi.fn().mockResolvedValue(ok({ orders: [order()] })),
    transition: vi.fn(),
    cancel: vi.fn(),
    undo: vi.fn(),
    retryRefund: vi.fn(),
    assignDeliverer: vi.fn().mockResolvedValue(ok({})),
    ...gateway,
  };
  const services = {
    orders,
    deliverers: { list: vi.fn().mockResolvedValue(ok({ deliverers: [] })) },
    realtime: { subscribe: vi.fn().mockReturnValue(() => {}) },
  } as unknown as PanelServices;
  const wrapper = ({ children }: { children: ReactNode }) => <PanelServicesProvider services={services}>{children}</PanelServicesProvider>;
  return { ...renderHook(() => usePedidos(), { wrapper }), orders };
}

beforeEach(() => {
  push.mockClear();
  runProtected.mockClear();
});

describe("usePedidos: estado de carregamento", () => {
  it("começa 'loading' e vira 'ready' com a 1ª resposta", async () => {
    const { result } = setup();
    expect(result.current.loadState).toBe("loading");
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
  });

  it("falha na 1ª carga vira 'error' e a lista continua vazia", async () => {
    const { result } = setup({ list: vi.fn().mockResolvedValue(fail(500, "x")) });
    await waitFor(() => expect(result.current.loadState).toBe("error"));
    expect(result.current.orders).toEqual([]);
  });

  it("'Tentar de novo' volta a 'loading' e, com sucesso, a 'ready'", async () => {
    const list = vi.fn().mockResolvedValueOnce(fail(500, "x")).mockResolvedValue(ok({ orders: [order()] }));
    const { result } = setup({ list });
    await waitFor(() => expect(result.current.loadState).toBe("error"));
    act(() => result.current.retryLoad());
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.orders).toHaveLength(1);
  });

  it("falha DEPOIS de já mostrar pedidos mantém a lista e o estado 'ready'", async () => {
    const list = vi.fn().mockResolvedValueOnce(ok({ orders: [order()] })).mockResolvedValue(fail(500, "x"));
    // A ação falha com um código que manda recarregar; a recarga também falha.
    const { result } = setup({ list, transition: vi.fn().mockResolvedValue(fail(409, "x", "ORDER_STATE_CHANGED")) });
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    await act(async () => {
      await result.current.transition(order(), action());
    });
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.loadState).toBe("ready");
    expect(result.current.orders).toHaveLength(1);
  });
});

describe("usePedidos: teto de abertos (API-70, WEB-37)", () => {
  it("guarda quantos abertos a API deixou de fora", async () => {
    const { result } = setup({ list: vi.fn().mockResolvedValue(ok({ orders: [order()], openCapped: true, openHidden: 12 })) });
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.openHidden).toBe(12);
  });

  it("API antiga (sem os campos) e teto não estourado: zero, sem faixa", async () => {
    const old = setup({ list: vi.fn().mockResolvedValue(ok({ orders: [order()] })) });
    await waitFor(() => expect(old.result.current.loadState).toBe("ready"));
    expect(old.result.current.openHidden).toBe(0);
    const calm = setup({ list: vi.fn().mockResolvedValue(ok({ orders: [order()], openCapped: false, openHidden: 0 })) });
    await waitFor(() => expect(calm.result.current.loadState).toBe("ready"));
    expect(calm.result.current.openHidden).toBe(0);
  });

  it("o número acompanha cada recarga: some quando o dono conclui os escondidos", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(ok({ orders: [order()], openCapped: true, openHidden: 3 }))
      .mockResolvedValue(ok({ orders: [order()], openCapped: false, openHidden: 0 }));
    const { result } = setup({ list, transition: vi.fn().mockResolvedValue(ok({ order: order({ canUndo: true }) })) });
    await waitFor(() => expect(result.current.openHidden).toBe(3));
    await act(async () => result.current.transition(order(), action()));
    await waitFor(() => expect(result.current.openHidden).toBe(0));
  });

  it("falha de recarga NÃO apaga a faixa: mantém o último valor, como mantém a lista", async () => {
    const list = vi.fn().mockResolvedValueOnce(ok({ orders: [order()], openCapped: true, openHidden: 5 })).mockResolvedValue(fail(500, "x"));
    const { result } = setup({ list, transition: vi.fn().mockResolvedValue(fail(409, "x", "ORDER_STATE_CHANGED")) });
    await waitFor(() => expect(result.current.openHidden).toBe(5));
    await act(async () => {
      await result.current.transition(order(), action());
    });
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.openHidden).toBe(5);
  });

  it("valor inválido da API (texto, negativo) vale zero", async () => {
    const { result } = setup({ list: vi.fn().mockResolvedValue(ok({ orders: [order()], openHidden: "muitos" })) });
    await waitFor(() => expect(result.current.loadState).toBe("ready"));
    expect(result.current.openHidden).toBe(0);
  });
});

describe("usePedidos: avançar pela aresta do servidor", () => {
  it("chama /transition com o estado de destino da ação e recarrega a lista", async () => {
    const { result, orders } = setup({ transition: vi.fn().mockResolvedValue(ok({ order: order({ canUndo: true }) })) });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    await act(async () => result.current.transition(order(), action()));
    expect(orders.transition).toHaveBeenCalledWith("o1", "CONFIRMADO");
    expect(orders.list).toHaveBeenCalledTimes(2);
  });

  it("oferece Desfazer só quando o servidor diz canUndo, com o texto 'Pedido #0123 · Aceito'", async () => {
    const { result } = setup({ transition: vi.fn().mockResolvedValue(ok({ order: order({ canUndo: true }) })) });
    await act(async () => result.current.transition(order(), action({ to: "CONFIRMADO" })));
    expect(result.current.undoOffer).toEqual({ orderId: "o1", text: "Pedido #0123 · Confirmado" });
  });

  it("sem canUndo não oferece desfazer", async () => {
    const { result } = setup({ transition: vi.fn().mockResolvedValue(ok({ order: order({ canUndo: false }) })) });
    await act(async () => result.current.transition(order(), action()));
    expect(result.current.undoOffer).toBeNull();
  });

  it("pedido mudou por outro lado: aviso em português e a lista é recarregada", async () => {
    const { result, orders } = setup({ transition: vi.fn().mockResolvedValue(fail(409, "state", "ORDER_STATE_CHANGED")) });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    await act(async () => result.current.transition(order(), action()));
    expect(result.current.notice).toBe("Este pedido já mudou. A tela foi atualizada.");
    expect(orders.list).toHaveBeenCalledTimes(2);
    expect(result.current.undoOffer).toBeNull();
  });

  it("sessão expirada manda para o login", async () => {
    const { result } = setup({ transition: vi.fn().mockResolvedValue(fail(401, "x")) });
    await act(async () => result.current.transition(order(), action()));
    expect(push).toHaveBeenCalledWith("/login");
  });
});

describe("usePedidos: desfazer", () => {
  it("chama /undo, some com a oferta e recarrega", async () => {
    const { result, orders } = setup({
      transition: vi.fn().mockResolvedValue(ok({ order: order({ canUndo: true }) })),
      undo: vi.fn().mockResolvedValue(ok({ order: order() })),
    });
    await act(async () => result.current.transition(order(), action()));
    await act(async () => result.current.undo("o1"));
    expect(orders.undo).toHaveBeenCalledWith("o1");
    expect(result.current.undoOffer).toBeNull();
  });

  it("prazo vencido: aviso com a regra, não o código", async () => {
    const { result } = setup({ undo: vi.fn().mockResolvedValue(fail(409, "x", "UNDO_WINDOW_EXPIRED")) });
    await act(async () => result.current.undo("o1"));
    expect(result.current.notice).toContain("Só o dono pode voltar agora");
    expect(result.current.notice).not.toContain("UNDO_WINDOW_EXPIRED");
  });
});

describe("usePedidos: cancelar com motivo", () => {
  const draft = { code: "ITEM_EM_FALTA" as const, text: "" };

  it("passa pelo passo de segurança (runProtected 'refund') e manda o corpo do contrato", async () => {
    const cancel = vi.fn().mockResolvedValue(ok({ order: order({ status: "CANCELADO" }) }));
    const { result } = setup({ cancel });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.cancel(order(), draft);
    });
    expect(runProtected).toHaveBeenCalledWith("refund", expect.any(Function));
    expect(cancel).toHaveBeenCalledWith("o1", { reason: { code: "ITEM_EM_FALTA", customerMessage: "Item indisponível no momento." }, acknowledgeClosedCash: false }, { headers: { "x-mfa-challenge": "ok" } });
    expect(outcome).toEqual({ kind: "done" });
  });

  it("estorno aceito: pedido cancelado, concluído", async () => {
    const { result } = setup({ cancel: vi.fn().mockResolvedValue(ok({ order: order(), refund: "DONE" })) });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.cancel(order(), draft);
    });
    expect(outcome).toEqual({ kind: "done" });
  });

  it("estorno NÃO aceito (202 PENDING): o resultado é 'refund-pending', não 'done'", async () => {
    const { result, orders } = setup({ cancel: vi.fn().mockResolvedValue(ok({ order: order(), refund: "PENDING" })) });
    await waitFor(() => expect(result.current.orders).toHaveLength(1));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.cancel(order(), draft);
    });
    expect(outcome).toEqual({ kind: "refund-pending" });
    expect(orders.list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("erro vira mensagem, nunca o código", async () => {
    const { result } = setup({ cancel: vi.fn().mockResolvedValue(fail(403, "x", "FORBIDDEN_ROLE")) });
    let outcome: { kind: string; message?: string } | undefined;
    await act(async () => {
      outcome = (await result.current.cancel(order(), draft)) as typeof outcome;
    });
    expect(outcome).toEqual({ kind: "error", message: "Seu perfil não permite esta ação." });
  });

  it("caixa fechado só vai marcado quando o dono confirmou", async () => {
    const cancel = vi.fn().mockResolvedValue(ok({ order: order() }));
    const { result } = setup({ cancel });
    await act(async () => result.current.cancel(order(), draft, true));
    expect(cancel.mock.calls[0][1].acknowledgeClosedCash).toBe(true);
  });
});

describe("usePedidos: tentar o estorno de novo", () => {
  it("usa /refund/retry pelo passo de segurança e informa se continua pendente", async () => {
    const retryRefund = vi.fn().mockResolvedValueOnce(ok({ order: order(), refund: "PENDING" })).mockResolvedValueOnce(ok({ order: order(), refund: "DONE" }));
    const { result } = setup({ retryRefund });
    let first: unknown;
    let second: unknown;
    await act(async () => {
      first = await result.current.retryRefund(order());
    });
    await act(async () => {
      second = await result.current.retryRefund(order());
    });
    expect(first).toEqual({ kind: "refund-pending" });
    expect(second).toEqual({ kind: "done" });
    expect(runProtected).toHaveBeenCalledTimes(2);
  });
});
