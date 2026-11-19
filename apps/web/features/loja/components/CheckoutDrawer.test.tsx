import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StoreInfo } from "@/core/domain/storefront";
import type { StorefrontGateway } from "@/core/gateways/StorefrontGateway";
import { CheckoutDrawer } from "./CheckoutDrawer";

const store: StoreInfo = {
  name: "Loja", slug: "loja", logoUrl: null, coverImageUrl: null, primaryColor: null, address: null, whatsapp: null, openingHours: null,
  minOrderCents: null, deliveryEnabled: true, pickupEnabled: true, acceptingOrders: true, deliveryFeeCents: 500,
};

function setup(over: Partial<React.ComponentProps<typeof CheckoutDrawer>> = {}) {
  const onSubmit = vi.fn();
  const props = { store, subtotalCents: 5000, closed: false, submitting: false, error: null, onClose: vi.fn(), onSubmit, ...over };
  render(<CheckoutDrawer {...props} />);
  return { ...props, onSubmit };
}

async function fillValid() {
  await userEvent.type(screen.getByLabelText(/^Nome/), "Maria");
  await userEvent.type(screen.getByLabelText(/^Telefone/), "21999999999");
  await userEvent.type(screen.getByLabelText(/^Endereço de entrega/), "Rua A, 1");
}

it("reconfirma uma taxa alterada pelo servidor sem reenviar o pedido automaticamente", async () => {
  const getDeliveryZones = vi.fn().mockResolvedValue({ ok: true, data: {
    zones: [{ id: "centro", name: "Centro", feeCents: 300 }], outsideMode: "REFUSE",
    defaultFeeCents: 500, freeShippingFromCents: null,
  } });
  const props = { store, subtotalCents: 5000, closed: false, submitting: false, error: null, onClose: vi.fn(), onSubmit: vi.fn(),
    gateway: { getDeliveryZones } as unknown as StorefrontGateway };
  const { rerender } = render(<CheckoutDrawer {...props} />);
  await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Bairro da entrega" }), "centro");
  await fillValid();
  await userEvent.click(screen.getByRole("button", { name: /Finalizar pedido/ }));
  expect(props.onSubmit.mock.calls[0][0]).toMatchObject({ neighborhoodId: "centro", expectedDeliveryFeeCents: 300 });
  rerender(<CheckoutDrawer {...props} error="A taxa mudou." errorCode="DELIVERY_FEE_CHANGED"
    errorDetails={{ deliveryFeeCents: 600, totalCents: 5600 }} />);
  const confirm = await screen.findByRole("button", { name: /Confirmar novo total/ });
  expect(props.onSubmit).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveTextContent("56,00");
  await userEvent.click(confirm);
  expect(props.onSubmit.mock.calls[1][0].expectedDeliveryFeeCents).toBe(600);
});

describe("CheckoutDrawer: rótulos e campos (spec 09 §10.2)", () => {
  it("todo campo tem rótulo visível, com 'obrigatório' em texto", () => {
    setup();
    expect(screen.getByLabelText(/^Nome/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Telefone \(com DDD\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Endereço de entrega/)).toBeInTheDocument();
    expect(screen.getByLabelText("Cupom de desconto (opcional)")).toBeInTheDocument();
    expect(screen.getAllByText("(obrigatório)")).toHaveLength(3);
  });

  it("autocomplete e teclado certos para nome, telefone e endereço", () => {
    setup();
    expect(screen.getByLabelText(/^Nome/)).toHaveAttribute("autocomplete", "name");
    const phone = screen.getByLabelText(/^Telefone/);
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(screen.getByLabelText(/^Endereço de entrega/)).toHaveAttribute("autocomplete", "street-address");
  });

  it("é um diálogo com título 'Finalizar pedido'", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Finalizar pedido" })).toBeInTheDocument();
  });

  it("Retirar no local esconde o endereço e a taxa de entrega", async () => {
    setup();
    expect(screen.getByText("Taxa de entrega")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Retirar no local" }));
    expect(screen.queryByLabelText(/^Endereço de entrega/)).not.toBeInTheDocument();
    expect(screen.queryByText("Taxa de entrega")).not.toBeInTheDocument();
  });
});

describe("CheckoutDrawer: forma de pagamento (UI-V-08)", () => {
  it("é um grupo de rádios em dois blocos, com Dinheiro marcado de início", () => {
    setup();
    expect(screen.getByRole("group", { name: "Pagar na entrega ou retirada" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Pagar agora" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dinheiro" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "PIX" })).not.toBeChecked();
  });

  it("sem PIX conectado o bloco 'Pagar agora' não aparece", () => {
    setup({ pixAvailable: false });
    expect(screen.queryByRole("radio", { name: "PIX" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Pagar agora" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dinheiro" })).toBeInTheDocument();
  });

  it("troco só aparece com Dinheiro", async () => {
    setup();
    expect(screen.getByLabelText("Troco para (opcional)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "PIX" }));
    expect(screen.queryByLabelText("Troco para (opcional)")).not.toBeInTheDocument();
  });

  it("gorjeta é um grupo de rádios com legenda", async () => {
    setup();
    const group = screen.getByRole("group", { name: "Gorjeta (opcional)" });
    expect(group).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "R$ 5,00" }));
    expect(screen.getByRole("radio", { name: "R$ 5,00" })).toBeChecked();
    expect(screen.getByText(/Gorjeta/, { selector: ".loja__summary-row span" })).toBeInTheDocument();
  });
});

describe("CheckoutDrawer: validação (UI-V-05)", () => {
  it("antes de tentar enviar não mostra erro nenhum", () => {
    setup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Nome/)).not.toHaveAttribute("aria-invalid");
  });

  it("enviar vazio: resumo role=alert, erro abaixo de cada campo, aria-invalid e foco no primeiro", async () => {
    const { onSubmit } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Finalizar pedido/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Corrija 3 campos para continuar.");
    const name = screen.getByLabelText(/^Nome/);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(/Informe seu nome/);
    expect(screen.getByLabelText(/^Telefone/)).toHaveAccessibleDescription(/telefone com DDD/);
    expect(screen.getByLabelText(/^Endereço de entrega/)).toHaveAccessibleDescription(/Informe o endereço de entrega/);
    expect(name).toHaveFocus();
  });

  it("o foco vai ao primeiro campo inválido, não ao primeiro da tela", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/^Nome/), "Maria");
    await userEvent.type(screen.getByLabelText(/^Telefone/), "21999999999");
    await userEvent.click(screen.getByRole("button", { name: /Finalizar pedido/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Corrija 1 campo para continuar.");
    expect(screen.getByLabelText(/^Endereço de entrega/)).toHaveFocus();
  });

  it("o texto do erro tem o marcador ✕ além da cor", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Finalizar pedido/ }));
    expect(screen.getByText("Informe seu nome.").parentElement).toHaveTextContent("✕");
  });

  it("corrigir o campo faz o erro sumir", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Finalizar pedido/ }));
    await userEvent.type(screen.getByLabelText(/^Nome/), "Maria");
    expect(screen.getByLabelText(/^Nome/)).not.toHaveAttribute("aria-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent("Corrija 2 campos para continuar.");
  });

  it("troco menor que o total vira erro do campo troco", async () => {
    setup();
    await fillValid();
    await userEvent.type(screen.getByLabelText("Troco para (opcional)"), "1000");
    await userEvent.click(screen.getByRole("button", { name: /Finalizar pedido/ }));
    expect(screen.getByLabelText("Troco para (opcional)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Troco para (opcional)")).toHaveFocus();
  });

  it("formulário válido envia com o total correto", async () => {
    const { onSubmit } = setup();
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: /Finalizar pedido/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [form, totals] = onSubmit.mock.calls[0];
    expect(form).toMatchObject({ customerName: "Maria", customerPhone: "21999999999", address: "Rua A, 1", deliveryType: "DELIVERY" });
    expect(totals.totalCents).toBe(5500);
  });
});

describe("CheckoutDrawer: erros do servidor e rede (UI-V-06)", () => {
  it("erro de envio aparece no topo como alerta, com Tentar de novo, e nada é apagado", async () => {
    const { onSubmit } = setup({ error: "Não foi possível conectar ao servidor. Verifique sua internet e tente de novo." });
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível conectar");
    await fillValid();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Nome/)).toHaveValue("Maria");
  });

  it("loja fechada avisa e bloqueia o envio", () => {
    setup({ closed: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Esta loja não está recebendo pedidos agora.");
    expect(screen.getByRole("button", { name: /Finalizar pedido/ })).toBeDisabled();
  });

  it("enquanto envia, o botão fica desabilitado e diz 'Enviando…'", () => {
    setup({ submitting: true });
    expect(screen.getByRole("button", { name: "Enviando…" })).toBeDisabled();
  });
});
