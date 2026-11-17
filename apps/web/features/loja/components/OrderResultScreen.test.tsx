import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  it("mostra 'Não feche esta página antes de pagar.' ACIMA do QR e o botão 'Copiar código PIX'", () => {
    setup({ pixData: pix });
    const warning = screen.getByText("Não feche esta página antes de pagar.");
    const qr = screen.getByAltText(/QR Code do PIX do pedido #/);
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
    expect(screen.getByText("Não feche esta página antes de pagar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).toBeInTheDocument();
  });

  it("pedido sem PIX não mostra aviso nem copiar", () => {
    setup();
    expect(screen.queryByText(/Não feche esta página/)).not.toBeInTheDocument();
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


describe("OrderResultScreen: tela recuperada depois de recarregar (WEB-33b, UI-V-20/21)", () => {
  const pix = { pixQrCode: "000201PIXCODE", pixQrCodeBase64: "QUJD" };
  const expires = Date.parse("2026-11-17T14:50:00");

  it("PIX válido: 'Pedido #0123 enviado', mesmo QR e copiar, prazo e faixa; sem cancelar e sem 'verificando'", () => {
    setup({ code: "0123", resume: "valid", trackingUnavailable: true, pixData: pix, pixExpiresAt: expires, summary: null, whatsapp: "5521999999999" });
    expect(screen.getByRole("heading", { name: "Pedido #0123 enviado" })).toBeInTheDocument();
    expect(screen.getByAltText(/QR Code do PIX do pedido #/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).toBeInTheDocument();
    expect(screen.getByLabelText("Código PIX (copia e cola)")).toHaveValue("000201PIXCODE");
    expect(screen.getByText("Depois de pagar, a loja recebe o pedido. Se tiver dúvida, fale com a loja.")).toBeInTheDocument();
    expect(screen.getByText(/Vale até 14:50/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Aguardando confirmação|Verificando/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Não feche esta página/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Se você já pagou/)).not.toBeInTheDocument(); // a faixa já diz o que importa
    expect(document.body.textContent).not.toMatch(/não encontr|não existe|telefone/i);
    expect(screen.getByRole("link", { name: "Falar com a loja no WhatsApp" })).toHaveAttribute("href", "https://wa.me/5521999999999?text=Pedido%20%230123");
  });

  it("sem prazo do servidor: mostra o QR e NÃO mostra 'Vale até' (nenhuma hora inventada)", () => {
    setup({ code: "0123", resume: "valid", trackingUnavailable: true, pixData: pix, pixExpiresAt: null, summary: null });
    expect(screen.getByAltText(/QR Code do PIX do pedido #/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).toBeInTheDocument();
    expect(screen.queryByText(/Vale até/)).not.toBeInTheDocument();
  });

  it("PIX válido sem WhatsApp: só o texto, sem botão", () => {
    setup({ code: "0123", resume: "valid", trackingUnavailable: true, pixData: pix, pixExpiresAt: expires, summary: null, whatsapp: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("PIX vencido: 'Este PIX venceu…', sem QR e sem pagar, 'Voltar ao cardápio' como botão primário", async () => {
    const { onBack } = setup({ code: "0123", resume: "expired", trackingUnavailable: true, pixData: null, summary: null, whatsapp: "5521999999999" });
    expect(screen.getByText("Este PIX venceu. Faça o pedido de novo. Se você já pagou, fale com a loja.")).toBeInTheDocument();
    expect(screen.queryByAltText(/QR Code do PIX/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar código PIX" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar pedido" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Falar com a loja no WhatsApp" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Voltar ao cardápio" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("PIX vencido sem WhatsApp: só o texto", () => {
    setup({ code: "0123", resume: "expired", trackingUnavailable: true, pixData: null, summary: null, whatsapp: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("o botão de copiar tem alvo de pelo menos 44 px (classe de botão principal, min-height 3rem)", () => {
    setup({ code: "0123", resume: "valid", trackingUnavailable: true, pixData: pix, pixExpiresAt: expires, summary: null });
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).toHaveClass("loja__cta");
  });
});


// ---- WEB-33b, parecer visual da Da Vinci (A1 a A5; spec 09 §10.6 "Ordem e hierarquia da tela do PIX")
const stubViewport = (wide: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: wide, media: query, addEventListener: () => {}, removeEventListener: () => {} }));

describe("OrderResultScreen: hierarquia, valor e ordem da tela do PIX (A1 a A4)", () => {
  const pix = { pixQrCode: "000201PIXCODE", pixQrCodeBase64: "QUJD" };
  const base = { code: "0101", resume: "valid" as const, trackingUnavailable: true, pixData: pix, pixExpiresAt: Date.parse("2026-11-17T04:45:00"), totalCents: 4500, storeName: "Pizzaria Boa", whatsapp: "5521999999999", summary: null };
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => stubViewport(true));

  it("A1: com PIX válido o ÚNICO primário é 'Copiar código PIX'; 'Voltar ao cardápio' é secundário (contorno)", () => {
    setup(base);
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).toHaveClass("loja__cta");
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).not.toHaveClass("loja__cta--outline");
    expect(screen.getByRole("button", { name: "Voltar ao cardápio" })).toHaveClass("loja__cta--outline");
  });

  it("A1: também na espera normal do PIX (pedido recém-feito, com acompanhamento)", () => {
    setup({ pixData: pix, totalCents: 4500, summary });
    expect(screen.getByRole("button", { name: "Voltar ao cardápio" })).toHaveClass("loja__cta--outline");
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).not.toHaveClass("loja__cta--outline");
  });

  it("A1: só no PIX VENCIDO 'Voltar ao cardápio' é o primário", () => {
    setup({ code: "0101", resume: "expired", trackingUnavailable: true, pixData: null, summary: null });
    expect(screen.getByRole("button", { name: "Voltar ao cardápio" })).not.toHaveClass("loja__cta--outline");
  });

  it("A1: sem PIX (dinheiro, cartão) nada muda: 'Voltar ao cardápio' segue primário", () => {
    setup();
    expect(screen.getByRole("button", { name: "Voltar ao cardápio" })).not.toHaveClass("loja__cta--outline");
  });

  it("A2: mostra 'Total a pagar: R$ 45,00' junto do 'Vale até'", () => {
    setup(base);
    expect(screen.getByText("Total a pagar: R$ 45,00")).toBeInTheDocument();
    const total = screen.getByText("Total a pagar: R$ 45,00");
    const until = screen.getByText(/Vale até 04:45/);
    expect(total.compareDocumentPosition(until) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("A2: na espera normal (recém-feito) também mostra o total a pagar; sem total guardado, não inventa", () => {
    const { onBack } = setup({ pixData: pix, totalCents: 3000, summary });
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText("Total a pagar: R$ 30,00")).toBeInTheDocument();
  });

  it("A2: sem totalCents a linha não aparece", () => {
    setup({ ...base, totalCents: null });
    expect(screen.queryByText(/Total a pagar/)).not.toBeInTheDocument();
  });

  it("A2: pedido sem PIX não mostra 'Total a pagar'", () => {
    setup({ totalCents: 4500 });
    expect(screen.queryByText(/Total a pagar/)).not.toBeInTheDocument();
  });

  it("A4: o nome da loja aparece ACIMA do título; sem nome, nada", () => {
    setup(base);
    const store = screen.getByText("Pizzaria Boa");
    const heading = screen.getByRole("heading", { name: "Pedido #0101 enviado" });
    expect(store.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("A4: sem storeName não renderiza linha vazia", () => {
    setup({ ...base, storeName: null });
    expect(document.querySelector(".loja__result-store")).toBeNull();
  });

  it("ordem completa: loja, título, total e prazo, copiar, copia e cola, QR, faixa, WhatsApp, voltar", () => {
    setup(base);
    const at = (el: Element | null) => {
      expect(el).not.toBeNull();
      return el as Element;
    };
    const sequence = [
      screen.getByText("Pizzaria Boa"),
      screen.getByRole("heading", { name: "Pedido #0101 enviado" }),
      screen.getByText("Total a pagar: R$ 45,00"),
      screen.getByText(/Vale até 04:45/),
      screen.getByRole("button", { name: "Copiar código PIX" }),
      screen.getByLabelText("Código PIX (copia e cola)"),
      screen.getByAltText(/QR Code do PIX/),
      screen.getByText("Depois de pagar, a loja recebe o pedido. Se tiver dúvida, fale com a loja."),
      screen.getByRole("link", { name: "Falar com a loja no WhatsApp" }),
      screen.getByRole("button", { name: "Voltar ao cardápio" }),
    ].map(at);
    for (let i = 0; i < sequence.length - 1; i++) {
      expect(sequence[i].compareDocumentPosition(sequence[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING, `passo ${i}`).toBeTruthy();
    }
  });

  it("A3: o WhatsApp vem DEPOIS do copia e cola e do QR (apoio, não compete com pagar)", () => {
    setup({ pixData: pix, trackingUnavailable: true, whatsapp: "5521999999999", summary: null });
    const code = screen.getByLabelText("Código PIX (copia e cola)");
    const link = screen.getByRole("link", { name: "Falar com a loja no WhatsApp" });
    expect(code.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("OrderResultScreen: celular, QR recolhido (A5)", () => {
  const pix = { pixQrCode: "000201PIXCODE", pixQrCodeBase64: "QUJD" };
  const base = { code: "0101", resume: "valid" as const, trackingUnavailable: true, pixData: pix, pixExpiresAt: null, totalCents: 4500, summary: null };
  afterEach(() => vi.unstubAllGlobals());

  it("< 800 px: 'Copie o código e pague no app do seu banco.', copiar em destaque e o QR recolhido atrás de 'Mostrar QR Code'", () => {
    stubViewport(false);
    setup(base);
    expect(screen.getByText("Copie o código e pague no app do seu banco.")).toBeInTheDocument();
    expect(screen.queryByText(/Escaneie o QR Code/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copiar código PIX" })).toBeInTheDocument();
    const summaryEl = screen.getByText("Mostrar QR Code");
    const details = summaryEl.closest("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    // recolhido, não removido: quem paga com outro aparelho ainda alcança o QR
    expect(details.querySelector("img")).not.toBeNull();
  });

  it("< 800 px: abrir a seção mostra o QR (funciona por teclado: é um <summary>)", async () => {
    stubViewport(false);
    setup(base);
    await userEvent.click(screen.getByText("Mostrar QR Code"));
    expect((screen.getByText("Mostrar QR Code").closest("details") as HTMLDetailsElement).open).toBe(true);
  });

  it(">= 800 px: QR visível acima da frase de escanear, sem seção recolhida", () => {
    stubViewport(true);
    setup(base);
    expect(screen.getByText("Escaneie o QR Code ou copie o código para pagar via PIX:")).toBeInTheDocument();
    expect(screen.queryByText("Mostrar QR Code")).not.toBeInTheDocument();
    expect(screen.getByAltText(/QR Code do PIX do pedido #0101/).closest("details")).toBeNull();
  });

  it("a frase do celular só vale com o botão 'Copiar código PIX' visível: sem copia e cola, volta a frase do QR", () => {
    stubViewport(false);
    setup({ ...base, pixData: { pixQrCode: null, pixQrCodeBase64: "QUJD" } });
    expect(screen.queryByText("Copie o código e pague no app do seu banco.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar código PIX" })).not.toBeInTheDocument();
  });

  it("o QR tem texto alternativo com o número do pedido", () => {
    stubViewport(true);
    setup(base);
    expect(screen.getByAltText("QR Code do PIX do pedido #0101")).toBeInTheDocument();
  });
});
