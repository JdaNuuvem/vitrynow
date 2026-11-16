import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  document.body.style.overflow = "";
});

describe("Sheet: diálogo acessível (spec 09 §10.2, UI-V-04)", () => {
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
