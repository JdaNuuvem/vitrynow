import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBrokenImage } from "./useBrokenImage";

function Photo({ src }: { src: string | null }) {
  const { ref, failed, onError } = useBrokenImage(src);
  return failed || !src ? <div data-testid="fallback" /> : <img ref={ref} src={src} alt="" onError={onError} data-testid="photo" />;
}

// jsdom nunca carrega imagem; estes helpers simulam o que o navegador já resolveu ANTES de hidratar.
function stubImageState(complete: boolean, naturalWidth: number) {
  Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => complete });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => naturalWidth });
}
afterEach(() => {
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
});

describe("useBrokenImage (B1 da revisão da Da Vinci)", () => {
  it("imagem que já falhou antes da hidratação (complete e largura 0) cai no fallback sem evento onError", () => {
    stubImageState(true, 0);
    render(<Photo src="http://localhost:9/nao-existe.jpg" />);
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("photo")).not.toBeInTheDocument();
  });

  it("imagem que carregou bem continua na tela", () => {
    stubImageState(true, 800);
    render(<Photo src="https://x/ok.png" />);
    expect(screen.getByTestId("photo")).toBeInTheDocument();
  });

  it("imagem ainda carregando não é tratada como quebrada", () => {
    stubImageState(false, 0);
    render(<Photo src="https://x/lenta.png" />);
    expect(screen.getByTestId("photo")).toBeInTheDocument();
  });

  it("falha depois da hidratação (evento onError) também cai no fallback", () => {
    stubImageState(false, 0);
    render(<Photo src="https://x/quebra-depois.png" />);
    fireEvent.error(screen.getByTestId("photo"));
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });

  it("trocar a URL dá uma nova chance (não fica preso no fallback)", () => {
    stubImageState(true, 0);
    const { rerender } = render(<Photo src="https://x/ruim.png" />);
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
    stubImageState(true, 400);
    rerender(<Photo src="https://x/boa.png" />);
    expect(screen.getByTestId("photo")).toBeInTheDocument();
  });

  it("sem URL usa o fallback direto", () => {
    render(<Photo src={null} />);
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });
});

// M-11 (spec 12 §8, Fatia 2): foto que ainda carrega fica transparente até o `load` e aparece com fade (CSS).
// A que já veio pronta do servidor NUNCA é escondida: nada de piscar, LCP intacto, e sem JS aparece igual.
describe("useBrokenImage: marca 'carregando' para o fade da foto (M-11)", () => {
  it("imagem ainda carregando ao hidratar recebe data-loading e perde ao carregar", () => {
    stubImageState(false, 0);
    render(<Photo src="https://x/lenta.png" />);
    const image = screen.getByTestId("photo");
    expect(image).toHaveAttribute("data-loading");
    fireEvent.load(image);
    expect(image).not.toHaveAttribute("data-loading");
  });

  it("se a imagem falhar, também deixa de ficar escondida (o fallback assume)", () => {
    stubImageState(false, 0);
    render(<Photo src="https://x/ruim.png" />);
    const image = screen.getByTestId("photo");
    expect(image).toHaveAttribute("data-loading");
    fireEvent.error(image);
    expect(screen.queryByTestId("photo")).not.toBeInTheDocument();
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });

  it("imagem que já veio pronta do servidor nunca é escondida", () => {
    stubImageState(true, 800);
    render(<Photo src="https://x/ok.png" />);
    expect(screen.getByTestId("photo")).not.toHaveAttribute("data-loading");
  });

  it("sem src não há o que esconder", () => {
    stubImageState(false, 0);
    render(<Photo src={null} />);
    expect(screen.queryByTestId("photo")).not.toBeInTheDocument();
  });
});
