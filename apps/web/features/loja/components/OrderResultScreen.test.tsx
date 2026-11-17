import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderSummary } from "../checkoutForm";
import { OrderResultScreen } from "./OrderResultScreen";

const summary: OrderSummary = {
  lines: ["1× Cheeseburguer + Bacon extra"],
  totalCents: 1900,
  paymentLabel: "Dinheiro",
  deliveryLabel: "Entrega",
  address: "Rua Fictícia, 100",
};

function setup(over: Partial<React.ComponentProps<typeof OrderResultScreen>> = {}) {
  const onBack = vi.fn();
  const onCancel = vi.fn().mockResolvedValue(undefined);
  const props = {
    code: "0001",
    cancelled: false,
    pixData: null,
    paymentConfirmed: false,
    paymentFailedMessage: null,
    cancelError: null,
    summary,
    onCancel,
    onBack,
    ...over,
  };
  render(<OrderResultScreen {...props} />);
  return { onBack, onCancel };
}

describe("OrderResultScreen: pedido enviado (UI-V-09)", () => {
  it("mostra o título, o número, o resumo e o total", () => {
    setup();
    expect(screen.getByRole("heading", { name: /Pedido enviado/ })).toBeInTheDocument();
    expect(screen.getByText("Pedido #0001")).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "Resumo do pedido" });
    expect(region).toHaveTextContent("1× Cheeseburguer + Bacon extra");
    expect(region).toHaveTextContent("Total R$ 19,00 · Dinheiro");
    expect(region).toHaveTextContent("Entrega · Rua Fictícia, 100");
  });

  it("texto neutro, sem prometer prazo", () => {
    setup();
    expect(screen.getByRole("status")).toHaveTextContent("A loja ainda precisa aceitar o pedido.");
  });

  it("o foco vai ao título para o leitor de tela anunciar o resultado", () => {
    setup();
    expect(screen.getByRole("heading", { name: /Pedido enviado/ })).toHaveFocus();
  });

  it("'Voltar ao cardápio' é o botão principal e 'Cancelar pedido' é secundário", async () => {
    const { onBack } = setup();
    const back = screen.getByRole("button", { name: "Voltar ao cardápio" });
    expect(back).toHaveClass("loja__cta");
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toHaveClass("loja__result-secondary");
    await userEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("sem resumo (quem chamou não montou) a tela ainda funciona", () => {
    setup({ summary: null });
    expect(screen.queryByRole("region", { name: "Resumo do pedido" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voltar ao cardápio" })).toBeInTheDocument();
  });
});

describe("OrderResultScreen: cancelar sem confirm() nativo", () => {
  it("nunca chama window.confirm e só cancela no segundo passo", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const { onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    expect(onCancel).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Cancelar este pedido?" });
    expect(dialog).toHaveTextContent("O pedido será cancelado e a loja será avisada.");
    const buttons = screen.getAllByRole("button", { name: "Cancelar pedido" });
    await userEvent.click(buttons[buttons.length - 1]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("'Manter pedido' fecha a folha sem cancelar", async () => {
    const { onCancel } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    await userEvent.click(screen.getByRole("button", { name: "Manter pedido" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("se o servidor recusa (loja já aceitou), mostra o erro na folha com o contato", async () => {
    setup({ cancelError: "A loja já aceitou o pedido. Fale com ela.", whatsapp: "5521999999999" });
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    expect(screen.getByRole("alert")).toHaveTextContent("A loja já aceitou o pedido. Fale com ela.");
    expect(screen.getByRole("link", { name: "Falar com a loja no WhatsApp" })).toHaveAttribute("href", "https://wa.me/5521999999999?text=Pedido%20%230001");
  });

  it("pedido cancelado mostra o título e só 'Voltar ao cardápio'", () => {
    setup({ cancelled: true });
    expect(screen.getByRole("heading", { name: "Pedido #0001 cancelado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
  });
});

describe("OrderResultScreen: PIX", () => {
  const pix = { pixQrCode: "000201abc", pixQrCodeBase64: null };

  it("aguardando: mostra o código copia e cola com rótulo e o aviso de espera", () => {
    setup({ pixData: pix });
    expect(screen.getByLabelText("Código PIX (copia e cola)")).toHaveValue("000201abc");
    expect(screen.getByRole("status")).toHaveTextContent("Aguardando confirmação do pagamento");
    expect(screen.getByRole("heading", { name: "Pedido #0001" })).toBeInTheDocument();
  });

  it("pago: confirma e não oferece mais cancelar", () => {
    setup({ pixData: pix, paymentConfirmed: true });
    expect(screen.getByRole("heading", { name: /Pagamento confirmado/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
  });

  it("expirado ou rejeitado: 'não concluído' com a mensagem como alerta", () => {
    setup({ pixData: pix, paymentFailedMessage: "O tempo do PIX acabou e o pagamento não foi feito. O pedido não foi concluído." });
    expect(screen.getByRole("heading", { name: "Pedido #0001 não concluído" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("O tempo do PIX acabou");
  });
});


describe("OrderResultScreen: sem acesso ao pedido neste aparelho (NG-16)", () => {
  it("pede para falar com a loja, com o contato, sem erro técnico e sem 'pedido não existe'", () => {
    setup({ trackingUnavailable: true, whatsapp: "5521999999999" });
    expect(screen.getByText("Não é possível acompanhar este pedido por aqui. Fale com a loja.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Falar com a loja no WhatsApp" })).toHaveAttribute("href", "https://wa.me/5521999999999?text=Pedido%20%230001");
    expect(document.body.textContent).not.toMatch(/não encontr|não existe|erro/i);
  });

  it("não oferece cancelar (a API recusaria) e não promete 'aguardando confirmação'", () => {
    setup({ trackingUnavailable: true, pixData: { pixQrCode: "000201...", pixQrCodeBase64: null } });
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Aguardando confirmação/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Código PIX (copia e cola)")).toBeInTheDocument(); // o cliente ainda consegue pagar
    expect(screen.getByRole("button", { name: "Voltar ao cardápio" })).toBeInTheDocument();
  });

  it("com acesso (padrão) nada muda: aguarda o pagamento e oferece cancelar", () => {
    setup({ pixData: { pixQrCode: "000201...", pixQrCodeBase64: null } });
    expect(screen.getByText(/Aguardando confirmação/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar pedido" })).toBeInTheDocument();
    expect(screen.queryByText(/Fale com a loja/)).not.toBeInTheDocument();
  });
});


describe("OrderResultScreen: contato da loja sem prometer telefone (WEB-33, Da Vinci)", () => {
  it("loja SEM whatsapp: só o texto, sem botão e sem a palavra telefone", () => {
    setup({ trackingUnavailable: true, whatsapp: null });
    expect(screen.getByText("Não é possível acompanhar este pedido por aqui. Fale com a loja.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/telefone|ligue/i);
  });

  it("loja COM whatsapp: abre só wa.me/<dígitos> com 'Pedido #código' codificado, sem token nem dado do cliente", () => {
    setup({ trackingUnavailable: true, whatsapp: "+55 (21) 99999-9999", code: "0123" });
    const href = screen.getByRole("link", { name: "Falar com a loja no WhatsApp" }).getAttribute("href");
    expect(href).toBe("https://wa.me/5521999999999?text=Pedido%20%230123");
    expect(href).not.toMatch(/token|mco_|Maria/);
  });

  it("whatsapp só com lixo (sem dígitos) é tratado como ausente", () => {
    setup({ trackingUnavailable: true, whatsapp: "---" });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("o link do cancelar recusado também usa o texto e o link novos", async () => {
    setup({ cancelError: "Não é possível cancelar por aqui. Fale com a loja.", whatsapp: "5521999999999" });
    await userEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Não é possível cancelar por aqui. Fale com a loja.");
    expect(screen.getByRole("link", { name: "Falar com a loja no WhatsApp" })).toBeInTheDocument();
  });
});

describe("OrderResultScreen: espera do PIX (aviso e copiar)", () => {
  const pix = { pixQrCode: "000201PIXCODE", pixQrCodeBase64: "QUJD" };
  afterEach(() => vi.unstubAllGlobals());

  it("mostra 'Não feche nem atualize esta página até pagar.' ACIMA do QR e o botão 'Copiar código PIX'", () => {
    setup({ pixData: pix });
    const warning = screen.getByText("Não feche nem atualize esta página até pagar.");
    const qr = screen.getByAltText("QR Code PIX");
    expect(warning.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).toBeInTheDocument();
  });

  it("copiar escreve o código na área de transferência e avisa", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    setup({ pixData: pix });
    await userEvent.click(screen.getByRole("button", { name: "Copiar código PIX" }));
    expect(writeText).toHaveBeenCalledWith("000201PIXCODE");
    expect(screen.getByText("Código PIX copiado.")).toBeInTheDocument();
  });

  it("sem permissão para copiar: seleciona o código e explica, sem erro técnico", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("negado")) } });
    setup({ pixData: pix });
    await userEvent.click(screen.getByRole("button", { name: "Copiar código PIX" }));
    expect(screen.getByText(/Não deu para copiar sozinho/)).toBeInTheDocument();
    expect(screen.getByLabelText("Código PIX (copia e cola)")).toHaveFocus();
  });

  it("sem acompanhamento (sem token) o aviso e o botão de copiar continuam: o cliente ainda precisa pagar", () => {
    setup({ pixData: pix, trackingUnavailable: true });
    expect(screen.getByText("Não feche nem atualize esta página até pagar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).toBeInTheDocument();
  });

  it("pedido sem PIX não mostra aviso nem copiar", () => {
    setup();
    expect(screen.queryByText(/Não feche nem atualize/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar código PIX" })).not.toBeInTheDocument();
  });
});


describe("OrderResultScreen: a frase 'a loja recebe o pedido' só em pedido PIX (Da Vinci/Leonardo)", () => {
  it("PIX sem acompanhamento: diz 'Se você já pagou, a loja recebe o pedido.'", () => {
    setup({ trackingUnavailable: true, pixData: { pixQrCode: "000201...", pixQrCodeBase64: null } });
    expect(screen.getByText("Se você já pagou, a loja recebe o pedido.")).toBeInTheDocument();
  });

  it("dinheiro ou cartão na entrega sem acompanhamento: a frase NÃO aparece (enganaria)", () => {
    setup({ trackingUnavailable: true, pixData: null });
    expect(screen.getByText("Não é possível acompanhar este pedido por aqui. Fale com a loja.")).toBeInTheDocument();
    expect(screen.queryByText(/já pagou/)).not.toBeInTheDocument();
  });

  it("com acompanhamento normal, nenhuma das duas frases aparece", () => {
    setup({ pixData: { pixQrCode: "000201...", pixQrCodeBase64: null } });
    expect(screen.queryByText(/já pagou/)).not.toBeInTheDocument();
  });
});
