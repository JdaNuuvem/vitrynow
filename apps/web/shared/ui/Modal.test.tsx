import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <Modal
        open={open}
        labelledBy="t"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <h2 id="t">Título</h2>
        <button>Primeiro</button>
        <button>Último</button>
      </Modal>
    </div>
  );
}

afterEach(() => {
  document.body.style.overflow = "";
});

describe("Modal compartilhado: foco (checklist UX-07 item 2)", () => {
  it("é um diálogo modal e o foco entra nele", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const dialog = screen.getByRole("dialog", { name: "Título" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
  });

  it("Tab do último volta ao primeiro; Shift+Tab do primeiro vai ao último", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    screen.getByRole("button", { name: "Último" }).focus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Último" })).toHaveFocus();
  });

  it("Esc fecha e devolve o foco a quem abriu", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Abrir" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("trava a rolagem do fundo enquanto aberto e a libera ao fechar", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });
});

// Defeito achado na revisão da WEB-05: o handler novo a cada render reiniciava o efeito do Modal.
function TypingHarness() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="panel-root">
      <aside>
        <a href="#menu">Menu lateral</a>
      </aside>
      <main>
        <button onClick={() => setOpen(true)}>Abrir</button>
        {/* onClose é uma função NOVA a cada render, como em quase todos os chamadores reais */}
        <Modal open={open} labelledBy="t" onClose={() => setOpen(false)}>
          <h2 id="t">Título</h2>
          <input aria-label="Nota" value={text} onChange={(event) => setText(event.target.value)} />
          <button>Confirmar</button>
        </Modal>
      </main>
    </div>
  );
}

describe("Modal: estável com handler novo a cada render", () => {
  it("digitar dentro da janela NÃO tira o foco do campo (antes o foco voltava ao painel a cada tecla)", async () => {
    render(<TypingHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const input = screen.getByRole("textbox", { name: "Nota" });
    await userEvent.click(input);
    await userEvent.keyboard("abc");
    expect(input).toHaveValue("abc");
    expect(input).toHaveFocus();
  });

  it("Esc depois de interagir devolve o foco ao botão que abriu, não ao topo da página", async () => {
    render(<TypingHarness />);
    const trigger = screen.getByRole("button", { name: "Abrir" });
    await userEvent.click(trigger);
    await userEvent.type(screen.getByRole("textbox", { name: "Nota" }), "x");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("Modal: o fundo fica inerte enquanto aberto (revisão da WEB-05, B1)", () => {
  it("menu lateral e conteúdo ficam inert; a janela não; ao fechar tudo volta", async () => {
    const { container } = render(<TypingHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(container.querySelector("aside")).toHaveAttribute("inert");
    expect(screen.getByRole("dialog")).not.toHaveAttribute("inert");
    expect(screen.getByRole("dialog").closest("[inert]")).toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(container.querySelector("aside")).not.toHaveAttribute("inert");
  });

  it("não deixa inert para trás se a janela fechar", async () => {
    const { container } = render(<TypingHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await userEvent.keyboard("{Escape}");
    expect(container.querySelectorAll("[inert]")).toHaveLength(0);
  });
});

describe("Modal: folha que ocupa só o conteúdo (revisão da Da Vinci, W2)", () => {
  it("fitContent só vale junto com sheetOnMobile", () => {
    const { container, rerender } = render(
      <Modal open labelledBy="t" onClose={() => {}} sheetOnMobile fitContent>
        <h2 id="t">x</h2>
      </Modal>,
    );
    expect(container.querySelector(".ui-modal")).toHaveClass("ui-modal--sheet", "ui-modal--fit");
    rerender(
      <Modal open labelledBy="t" onClose={() => {}} fitContent>
        <h2 id="t">x</h2>
      </Modal>,
    );
    expect(container.querySelector(".ui-modal")).not.toHaveClass("ui-modal--fit");
  });

  it("sem fitContent a folha continua preenchendo a tela (padrão dos outros chamadores)", () => {
    const { container } = render(
      <Modal open labelledBy="t" onClose={() => {}} sheetOnMobile>
        <h2 id="t">x</h2>
      </Modal>,
    );
    expect(container.querySelector(".ui-modal")).toHaveClass("ui-modal--sheet");
    expect(container.querySelector(".ui-modal")).not.toHaveClass("ui-modal--fit");
  });
});

// Deming (resíduo do A2): o passo de MFA tem um campo com autoFocus. O React o foca no commit, antes dos efeitos do
// Modal; o "gatilho" guardado virava o próprio campo (que some ao fechar) e o foco caía no body.
describe("Modal compartilhado: devolve o foco a quem abriu mesmo com filho com autoFocus", () => {
  function WithAutoFocus() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button onClick={() => setOpen(true)}>Abrir com campo</button>
        <Modal open={open} labelledBy="t2" onClose={() => setOpen(false)}>
          <h2 id="t2">Código</h2>
          <input aria-label="Código de 6 dígitos" autoFocus />
          <button onClick={() => setOpen(false)}>Confirmar</button>
        </Modal>
      </div>
    );
  }

  it("o campo com autoFocus recebe o foco ao abrir", async () => {
    render(<WithAutoFocus />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir com campo" }));
    expect(screen.getByRole("textbox", { name: "Código de 6 dígitos" })).toBeInTheDocument();
  });

  it("ao fechar, o foco volta ao botão que abriu (não ao body)", async () => {
    render(<WithAutoFocus />);
    const opener = screen.getByRole("button", { name: "Abrir com campo" });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(opener).toHaveFocus();
  });

  it("ao fechar por Esc também", async () => {
    render(<WithAutoFocus />);
    const opener = screen.getByRole("button", { name: "Abrir com campo" });
    await userEvent.click(opener);
    await userEvent.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("janela sobre janela (MFA sobre a folha): fechar a de cima devolve o foco ao botão da folha de baixo", async () => {
    function Stacked() {
      const [sheet, setSheet] = useState(true);
      const [mfa, setMfa] = useState(false);
      return (
        <div>
          <Modal open={sheet} labelledBy="s" onClose={() => setSheet(false)}>
            <h2 id="s">Folha</h2>
            <button onClick={() => setMfa(true)}>Confirmar estorno</button>
          </Modal>
          <Modal open={mfa} labelledBy="m" onClose={() => setMfa(false)}>
            <h2 id="m">Código</h2>
            <input aria-label="Código" autoFocus />
            <button onClick={() => setMfa(false)}>Enviar código</button>
          </Modal>
        </div>
      );
    }
    render(<Stacked />);
    const confirm = screen.getByRole("button", { name: "Confirmar estorno" });
    await userEvent.click(confirm);
    await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    expect(confirm).toHaveFocus();
  });
});

