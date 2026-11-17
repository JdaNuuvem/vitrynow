import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail } from "@/core/domain/orderDetail";
import type { Deliverer } from "@/core/domain/orders";
import type { HttpResult } from "@/core/http/HttpClient";
import { PanelServicesProvider, type PanelServices } from "@/core/services/PanelServices";
import { OrderDetailPanel } from "./OrderDetailPanel";

const router = { push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const NOW = Date.parse("2026-11-17T20:00:00.000Z");

const detail = (over: Partial<OrderDetail> = {}): OrderDetail =>
  ({
    id: "o1",
    code: "0123",
    type: "DELIVERY",
    status: "EM_PREPARO",
    awaitingPayment: false,
    customerName: "Ana Souza",
    customerPhone: "(11) 91234-5678",
    hasPhone: true,
    address: "Rua das Flores, 10\napto 4\nVila Nova",
    hasAddress: true,
    contactMasked: false,
    notes: "Alergia a amendoim. Sem cebola, por favor.",
    subtotalCents: 9700,
    discountCents: 970,
    deliveryFeeCents: 600,
    tipCents: 200,
    totalCents: 9530,
    paymentMethod: "DINHEIRO",
    changeForCents: 10000,
    delivererId: null,
    deliverer: null,
    printedAt: "2026-11-17T19:03:00.000Z",
    createdAt: "2026-11-17T19:00:00.000Z",
    updatedAt: "2026-11-17T19:20:00.000Z",
    canceledAt: null,
    items: [
      { id: "i1", productName: "Calabresa", quantity: 2, unitPriceCents: 4500, notes: "sem cebola" },
      { id: "i2", productName: "Guaraná 350 ml", quantity: 1, unitPriceCents: 700, notes: null },
    ],
    payment: null,
    allowedTransitions: [{ to: "PRONTO", label: "Marcar pronto", kind: "ADVANCE", primary: true }],
    blocked: [],
    canUndo: false,
    undoUntil: null,
    cancel: null,
    ...over,
  }) as OrderDetail;

const ok = <T,>(data: T): HttpResult<T> => ({ ok: true, data });
const fail = (status: number): HttpResult<never> => ({ ok: false, status, error: "x" });

const deliverers: Deliverer[] = [{ id: "d1", name: "Carlos Lima", phone: null, active: true }];

function setup(get: ReturnType<typeof vi.fn>, over: Partial<React.ComponentProps<typeof OrderDetailPanel>> = {}) {
  const handlers = { onClose: vi.fn(), onAdvance: vi.fn(), onOpenCancel: vi.fn(), onUndo: vi.fn(), onRetryRefund: vi.fn(), onAssignDeliverer: vi.fn() };
  render(
    <PanelServicesProvider services={{ orders: { get } } as unknown as PanelServices}>
      <OrderDetailPanel orderId="o1" listOrder={undefined} refreshKey="a" deliverers={deliverers} nowMs={NOW} busy={false} canRetryRefund desktop {...handlers} {...over} />
    </PanelServicesProvider>,
  );
  return { get, ...handlers };
}

const section = (name: string) => screen.getByRole("region", { name }) as HTMLElement;

beforeEach(() => router.push.mockReset());

describe("OrderDetailPanel: entrega com tudo (UI-D-02, UI-D-03)", () => {
  it("mostra cliente, endereço, observação inteira, itens, valores, pagamento com troco e entregador", async () => {
    setup(vi.fn().mockResolvedValue(ok({ order: detail() })));
    expect(await screen.findByRole("heading", { level: 2, name: "Pedido #0123" })).toBeInTheDocument();
    expect(within(section("Cliente")).getByText("Ana Souza")).toBeInTheDocument();
    expect(within(section("Cliente")).getByText("(11) 91234-5678")).toBeInTheDocument();
    expect(within(section("Entrega")).getByText(/Rua das Flores, 10/)).toBeInTheDocument();
    expect(within(section("Observação do cliente")).getByText("Alergia a amendoim. Sem cebola, por favor.")).toBeInTheDocument();
    const items = within(section("Itens"));
    expect(items.getByText("2× Calabresa")).toBeInTheDocument();
    expect(items.getByText(/R\$\s?90,00/)).toBeInTheDocument(); // 2 × 45,00
    expect(items.getByText("Obs.: sem cebola")).toBeInTheDocument();
    const values = within(section("Valores"));
    expect(values.getByText(/Gorjeta/)).toBeInTheDocument();
    expect(values.getByText(/fora do faturamento/)).toBeInTheDocument();
    expect(values.getByText(/R\$\s?95,30/)).toBeInTheDocument();
    const pagamento = within(section("Pagamento"));
    expect(pagamento.getByText("Cobrar R$ 95,30 em dinheiro")).toBeInTheDocument();
    expect(pagamento.getByText(/Troco para R\$\s?100,00 → levar R\$\s?4,70/)).toBeInTheDocument();
    expect(within(section("Entregador")).getByRole("combobox")).toBeInTheDocument();
  });

  it("observação com alergia aparece INTEIRA, mesmo muito longa (CA-DET-13)", async () => {
    const longo = `Alergia grave a amendoim e castanhas. ${"Sem traços de nozes. ".repeat(30)}`.trim();
    setup(vi.fn().mockResolvedValue(ok({ order: detail({ notes: longo }) })));
    await screen.findByRole("heading", { level: 2, name: "Pedido #0123" });
    expect(within(section("Observação do cliente")).getByText(longo)).toBeInTheDocument();
  });

  it("Ligar e WhatsApp com o telefone certo; WhatsApp abre fora, com texto só 'Pedido #0123' (UI-D-05)", async () => {
    setup(vi.fn().mockResolvedValue(ok({ order: detail() })));
    const ligar = await screen.findByRole("link", { name: "Ligar para Ana Souza" });
    expect(ligar).toHaveAttribute("href", "tel:+5511912345678");
    const whats = screen.getByRole("link", { name: /Abrir o WhatsApp de Ana Souza/ });
    expect(whats.getAttribute("href")).toBe("https://wa.me/5511912345678?text=Pedido%20%230123");
    expect(whats).toHaveAttribute("target", "_blank");
    expect(whats).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("Copiar endereço copia e anuncia 'Endereço copiado' (UI-D-06)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    setup(vi.fn().mockResolvedValue(ok({ order: detail() })));
    await userEvent.click(await screen.findByRole("button", { name: "Copiar endereço" }));
    expect(writeText).toHaveBeenCalledWith("Rua das Flores, 10\napto 4\nVila Nova");
    expect(await screen.findByText("Endereço copiado")).toBeInTheDocument();
  });

  it("Abrir no mapa abre fora, só por clique, com o aviso de serviço externo", async () => {
    setup(vi.fn().mockResolvedValue(ok({ order: detail() })));
    const mapa = await screen.findByRole("link", { name: /Abrir o endereço no mapa/ });
    expect(mapa).toHaveAttribute("target", "_blank");
    expect(mapa.getAttribute("href")).toMatch(/^https:\/\/www\.google\.com\/maps\/search\//);
    expect(screen.getByText("Abre um serviço de mapas externo.")).toBeInTheDocument();
  });
});

describe("OrderDetailPanel: tipos de pedido e máscara do servidor (UI-D-04, CA-DET-06)", () => {
  it("retirada: sem bloco de Entrega nem de Entregador", async () => {
    setup(vi.fn().mockResolvedValue(ok({ order: detail({ type: "BALCAO", address: null, hasAddress: false, deliveryFeeCents: 0 }) })));
    await screen.findByRole("heading", { level: 2, name: "Pedido #0123" });
    expect(screen.queryByRole("region", { name: "Entrega" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Entregador" })).not.toBeInTheDocument();
  });

  it("mesa sem telefone: nenhum botão de contato", async () => {
    setup(vi.fn().mockResolvedValue(ok({ order: detail({ type: "MESA", customerPhone: null, hasPhone: false, address: null, hasAddress: false }) })));
    await screen.findByRole("heading", { level: 2, name: "Pedido #0123" });
    expect(screen.queryByRole("link", { name: /Ligar|WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Entrega" })).not.toBeInTheDocument();
  });

  it("contato mascarado pelo servidor: mostra o que veio, sem Ligar/WhatsApp, e diz para pedir ao dono", async () => {
    setup(vi.fn().mockResolvedValue(ok({ order: detail({ customerPhone: "*******5678", contactMasked: true, address: null, hasAddress: true }) })));
    await screen.findByRole("heading", { level: 2, name: "Pedido #0123" });
    expect(screen.getByText("*******5678")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ligar|WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.getByText("Contato protegido. Peça ao dono para ver o número.")).toBeInTheDocument();
    expect(screen.getByText("Endereço protegido. Peça ao dono para ver.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar endereço" })).not.toBeInTheDocument();
  });

  it("falha fechada do servidor (contactUnavailable): avisa, oferece repetir e MANTÉM o resto do pedido (API-54b)", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(ok({ order: detail({ customerPhone: "*******5678", contactMasked: true, address: null, hasAddress: true, contactUnavailable: "AUDIT_UNAVAILABLE" }) }))
      .mockResolvedValueOnce(ok({ order: detail() }));
    setup(get);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Contato indisponível agora. Tente de novo.");
    // o resto do pedido segue na tela
    expect(within(section("Itens")).getByText("2× Calabresa")).toBeInTheDocument();
    expect(within(section("Pagamento")).getByText("Cobrar R$ 95,30 em dinheiro")).toBeInTheDocument();
    // não confunde com "peça ao dono": não é questão de papel
    expect(screen.queryByText(/Peça ao dono/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ligar|WhatsApp/ })).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("link", { name: "Ligar para Ana Souza" })).toBeInTheDocument();
    expect(screen.queryByText(/Contato indisponível/)).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("pedido cancelado mostra quem, quando, o motivo interno e a frase que o cliente viu, em linhas separadas (CA-DET-11)", async () => {
    const cancelled = detail({
      status: "CANCELADO",
      allowedTransitions: [],
      cancel: { reasonCode: "ITEM_EM_FALTA", reasonText: null, customerMessage: "Item indisponível no momento.", at: "2026-11-17T19:30:00.000Z", by: "OWNER" },
    });
    setup(vi.fn().mockResolvedValue(ok({ order: cancelled })));
    const cancel = within(await screen.findByRole("region", { name: "Cancelamento" }));
    expect(cancel.getByText(/Pelo dono às 16:30/)).toBeInTheDocument();
    expect(cancel.getByText("Motivo (só a loja vê): Item em falta")).toBeInTheDocument();
    expect(cancel.getByText("O cliente viu: “Item indisponível no momento.”")).toBeInTheDocument();
  });

  it("não vaza id do provedor, token nem e-mail em lugar nenhum da tela (UI-D-11)", async () => {
    const dirty = { ...detail({ payment: { status: "APROVADO", amountCents: 9530, expiresAt: null, refundPending: false, reconcileRequired: false }, paymentMethod: "PIX" }), providerPaymentId: "mp_998877", payerEmail: "pagador@mp.com" };
    setup(vi.fn().mockResolvedValue(ok({ order: dirty })));
    await screen.findByRole("heading", { level: 2, name: "Pedido #0123" });
    expect(document.body.textContent).not.toMatch(/mp_998877|pagador@mp\.com/);
    expect(screen.getByText("Pago online (PIX)")).toBeInTheDocument();
  });
});

describe("OrderDetailPanel: ações do servidor (UI-D-14)", () => {
  it("o rodapé mostra o botão principal vindo de allowedTransitions e ele avança o pedido", async () => {
    const { onAdvance } = setup(vi.fn().mockResolvedValue(ok({ order: detail() })));
    await userEvent.click(await screen.findByRole("button", { name: "Marcar pronto" }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("escolher o entregador chama a atribuição", async () => {
    const { onAssignDeliverer } = setup(vi.fn().mockResolvedValue(ok({ order: detail() })));
    await userEvent.selectOptions(await screen.findByRole("combobox"), "d1");
    expect(onAssignDeliverer).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }), "d1");
  });
});

describe("OrderDetailPanel: estados de tela (spec 11 §6)", () => {
  it("carregando: título do que o quadro já sabe e 'Carregando pedido…' (não vazio)", () => {
    setup(vi.fn().mockReturnValue(new Promise(() => {})), { listOrder: { code: "0123" } as never });
    expect(screen.getByRole("heading", { level: 2, name: "Pedido #0123" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando pedido…");
    expect(screen.queryByRole("button", { name: "Marcar pronto" })).not.toBeInTheDocument();
  });

  it("pedido inexistente ou de outra loja (404): a mesma frase 'Pedido não encontrado.'", async () => {
    setup(vi.fn().mockResolvedValue(fail(404)));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pedido não encontrado.");
  });

  it("erro de rede: alerta com 'Tentar de novo' que busca outra vez", async () => {
    const get = vi.fn().mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(ok({ order: detail() }));
    setup(get);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível abrir o pedido.");
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Pedido #0123" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("falha ao recarregar com o pedido já na tela: mantém o pedido e avisa", async () => {
    const get = vi.fn().mockResolvedValueOnce(ok({ order: detail() })).mockResolvedValueOnce(fail(500));
    const { rerender } = (() => {
      const handlers = { onClose: vi.fn(), onAdvance: vi.fn(), onOpenCancel: vi.fn(), onUndo: vi.fn(), onRetryRefund: vi.fn(), onAssignDeliverer: vi.fn() };
      const ui = (key: string) => (
        <PanelServicesProvider services={{ orders: { get } } as unknown as PanelServices}>
          <OrderDetailPanel orderId="o1" listOrder={undefined} refreshKey={key} deliverers={deliverers} nowMs={NOW} busy={false} canRetryRefund desktop {...handlers} />
        </PanelServicesProvider>
      );
      return render(ui("a")) && { rerender: (key: string) => render(ui(key)) };
    })();
    await screen.findAllByRole("heading", { level: 2, name: "Pedido #0123" });
    rerender("b");
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("Não foi possível abrir o pedido.");
  });

  it("mudou no quadro (refreshKey novo): recarrega o detalhe sozinho", async () => {
    const get = vi.fn().mockResolvedValue(ok({ order: detail() }));
    const handlers = { onClose: vi.fn(), onAdvance: vi.fn(), onOpenCancel: vi.fn(), onUndo: vi.fn(), onRetryRefund: vi.fn(), onAssignDeliverer: vi.fn() };
    const services = { orders: { get } } as unknown as PanelServices;
    const view = (key: string) => (
      <PanelServicesProvider services={services}>
        <OrderDetailPanel orderId="o1" listOrder={undefined} refreshKey={key} deliverers={deliverers} nowMs={NOW} busy={false} canRetryRefund desktop {...handlers} />
      </PanelServicesProvider>
    );
    const { rerender } = render(view("a"));
    await screen.findByRole("heading", { level: 2, name: "Pedido #0123" });
    rerender(view("b"));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

describe("OrderDetailPanel: teclado e foco (UI-D-15)", () => {
  it("desktop: o foco entra no título e Esc fecha", async () => {
    const { onClose } = setup(vi.fn().mockResolvedValue(ok({ order: detail() })));
    const title = await screen.findByRole("heading", { level: 2, name: "Pedido #0123" });
    expect(title).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("desktop: é um painel (aside) NÃO modal, com nome do pedido", async () => {
    setup(vi.fn().mockResolvedValue(ok({ order: detail() })));
    await screen.findByRole("heading", { level: 2, name: "Pedido #0123" });
    expect(screen.getByRole("complementary", { name: "Detalhe do pedido 0123" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("desktop: com outra janela aberta por cima (cancelar), o Esc NÃO fecha o painel", async () => {
    const { onClose } = setup(vi.fn().mockResolvedValue(ok({ order: detail() })));
    await screen.findByRole("heading", { level: 2, name: "Pedido #0123" });
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    document.body.appendChild(overlay);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    overlay.remove();
  });

  it("celular/tablet: é um diálogo modal e o botão Fechar tem 44 px de nome acessível", async () => {
    const { onClose } = setup(vi.fn().mockResolvedValue(ok({ order: detail() })), { desktop: false });
    await screen.findAllByRole("heading", { level: 2, name: "Pedido #0123" });
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    await userEvent.click(screen.getByRole("button", { name: "Fechar detalhe do pedido" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
