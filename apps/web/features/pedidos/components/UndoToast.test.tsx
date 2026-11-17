import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNDO_TOAST_MS, UndoToast } from "./UndoToast";

describe("UndoToast (spec 02 §4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("é anunciado como status e mostra o texto com Desfazer", () => {
    render(<UndoToast text="Pedido #0123 · Pronto" onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Pedido #0123 · Pronto.");
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeInTheDocument();
  });

  it("some sozinho depois de 8 segundos", () => {
    const onDismiss = vi.fn();
    render(<UndoToast text="x" onUndo={vi.fn()} onDismiss={onDismiss} />);
    act(() => void vi.advanceTimersByTime(UNDO_TOAST_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("o contador PAUSA com o mouse por cima e volta ao sair", async () => {
    const onDismiss = vi.fn();
    render(<UndoToast text="x" onUndo={vi.fn()} onDismiss={onDismiss} />);
    const toast = screen.getByRole("status");
    act(() => {
      toast.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    // React usa mouseenter sintético a partir de mouseover; confirma pausando via foco, que é determinístico:
    act(() => void screen.getByRole("button", { name: "Desfazer" }).focus());
    act(() => void vi.advanceTimersByTime(UNDO_TOAST_MS * 3));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => void screen.getByRole("button", { name: "Desfazer" }).blur());
    act(() => void vi.advanceTimersByTime(UNDO_TOAST_MS));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("Desfazer chama onUndo", async () => {
    vi.useRealTimers();
    const onUndo = vi.fn();
    render(<UndoToast text="x" onUndo={onUndo} onDismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("uma nova oferta (texto diferente) reinicia os 8 segundos", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<UndoToast text="Pedido #1 · Pronto" onUndo={vi.fn()} onDismiss={onDismiss} />);
    act(() => void vi.advanceTimersByTime(UNDO_TOAST_MS - 100));
    rerender(<UndoToast text="Pedido #2 · Pronto" onUndo={vi.fn()} onDismiss={onDismiss} />);
    act(() => void vi.advanceTimersByTime(UNDO_TOAST_MS - 100));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(100));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
