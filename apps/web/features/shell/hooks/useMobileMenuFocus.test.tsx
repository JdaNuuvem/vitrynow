import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMobileMenuFocus } from "./useMobileMenuFocus";

function Menu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useMobileMenuFocus(open, ref, onClose);
  return (
    <aside ref={ref} tabIndex={-1} aria-label="Menu do painel">
      <a href="#a">Início</a>
    </aside>
  );
}

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Mais</button>
      <Menu
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    </div>
  );
}

describe("useMobileMenuFocus (UX-17)", () => {
  it("ao abrir, o foco entra no menu", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Mais" }));
    expect(screen.getByRole("complementary", { name: "Menu do painel" })).toHaveFocus();
  });

  it("antes de abrir o foco não é roubado", () => {
    render(<Harness />);
    expect(screen.getByRole("complementary", { name: "Menu do painel" })).not.toHaveFocus();
  });

  it("Esc fecha e o foco volta ao botão que abriu", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const trigger = screen.getByRole("button", { name: "Mais" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveFocus();
  });

  it("Esc com o menu fechado não faz nada", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("depois de fechar, o Esc não fica preso ao documento", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Mais" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
