import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

// A vitrine real renderiza a folha dentro de <main> dentro de .loja: o teste imita isso.
function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="loja">
      <a href="#x" className="loja__skip">
        pular
      </a>
      <main>
        <button onClick={() => setOpen(true)}>Abrir carrinho</button>
        <nav>
          <button>Buscar</button>
        </nav>
        {open && (
          <Sheet
            title="Seu carrinho"
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          >
            <input aria-label="Campo A" />
            <button>Continuar</button>
          </Sheet>
        )}
      </main>
    </div>
  );
}

const reducedMotion = (matches: boolean) =>
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() }));

afterEach(() => {
  document.body.style.overflow = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Sheet: diálogo acessível (spec 09 §10.2, UI-V-04)", () => {
  // sem animação de saída (menos movimento): fecha na hora, como antes da Fatia 2
  beforeEach(() => reducedMotion(true));

  it("é um diálogo modal com o título associado", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir carrinho" }));
    const dialog = screen.getByRole("dialog", { name: "Seu carrinho" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("o foco entra na folha ao abrir", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir carrinho" }));
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("o botão fechar tem nome acessível 'Fechar'", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir carrinho" }));
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
  });

  it("o fundo fica inert enquanto aberto e volta ao normal ao fechar", async () => {
    const { container } = render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir carrinho" }));
    expect(container.querySelector(".loja__skip")).toHaveAttribute("inert");
    expect(container.querySelector("nav")).toHaveAttribute("inert");
    expect(screen.getByRole("dialog")).not.toHaveAttribute("inert");
    await userEvent.keyboard("{Escape}");
    expect(container.querySelector(".loja__skip")).not.toHaveAttribute("inert");
    expect(container.querySelector("nav")).not.toHaveAttribute("inert");
  });

  it("Tab não escapa da folha: do último volta ao primeiro, e Shift+Tab do primeiro vai ao último", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir carrinho" }));
    const fechar = screen.getByRole("button", { name: "Fechar" });
    const continuar = screen.getByRole("button", { name: "Continuar" });
    continuar.focus();
    await userEvent.tab();
    expect(fechar).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(continuar).toHaveFocus();
  });

  it("Esc fecha e o foco volta ao botão que abriu", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Abrir carrinho" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("tocar no fundo fecha; tocar dentro da folha não", async () => {
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir carrinho" }));
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(container.querySelector(".loja__sheet") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("trava a rolagem do fundo enquanto aberto e a libera ao fechar", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir carrinho" }));
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });
});

// M-08 (spec 12 §8, Fatia 2): a folha entra em 280 ms e SAI em 200 ms; só some do DOM depois da saída.
describe("Sheet: saída animada (M-08)", () => {
  // com timers falsos o userEvent espera em tempo real e trava: aqui os eventos são disparados direto (síncronos)
  const open = () => fireEvent.click(screen.getByRole("button", { name: "Abrir carrinho" }));
  const esc = () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  beforeEach(() => {
    reducedMotion(false);
    vi.useFakeTimers();
  });

  it("Esc toca a saída (classe --closing) e só avisa quem abriu depois de 200 ms", () => {
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    open();
    esc();
    expect(container.querySelector(".loja__sheet")).toHaveClass("loja__sheet--closing");
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("fechar de novo durante a saída não avisa duas vezes", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    open();
    esc();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a folha continua um diálogo e o fundo continua inerte DURANTE a saída (some só no fim)", () => {
    const { container } = render(<Harness />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(container.querySelector("nav")).toHaveAttribute("inert");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector("nav")).not.toHaveAttribute("inert");
  });

  it("menos movimento: fecha na hora, sem classe de saída nem espera", () => {
    reducedMotion(true);
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    open();
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("desmontar no meio da saída não deixa o timer vivo nem avisa depois", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Harness onClose={onClose} />);
    open();
    esc();
    unmount();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
