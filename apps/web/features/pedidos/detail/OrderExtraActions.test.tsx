import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail } from "@/core/domain/orderDetail";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { OrderExtraActions } from "./OrderExtraActions";

const runProtected = vi.fn((_purpose: string, call: (options?: unknown) => Promise<unknown>) => call({ headers: { "x-mfa": "ok" } }));
vi.mock("@/features/seguranca/SecurityConfirmProvider", () => ({ useSecurityConfirm: () => ({ runProtected }) }));

const order = (extra: Partial<OrderDetail> = {}) => ({
  id: "o1", code: "0042", status: "CONFIRMADO", internalNote: "", payment: null, ...extra,
}) as unknown as OrderDetail;

afterEach(() => vi.restoreAllMocks());

describe("ações extras do detalhe do pedido", () => {
  it("reimprimir chama a fila e avisa; pedido cancelado não oferece reimpressão", async () => {
    const post = vi.spyOn(FetchHttpClient.prototype, "post").mockResolvedValue({ ok: true, data: {} });
    const { rerender } = render(<OrderExtraActions order={order()} owner={false} onChanged={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Reimprimir tíquete" }));
    expect(await screen.findByText("Tíquete enviado para a impressora.")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/orders/o1/reprint");
    rerender(<OrderExtraActions order={order({ status: "CANCELADO" } as Partial<OrderDetail>)} owner={false} onChanged={() => {}} />);
    expect(screen.queryByRole("button", { name: "Reimprimir tíquete" })).not.toBeInTheDocument();
  });

  it("observação interna: salva o texto (vazio vira null) e mostra o que o servidor gravou", async () => {
    const post = vi.spyOn(FetchHttpClient.prototype, "post").mockResolvedValue({ ok: true, data: { internalNote: "Ligar ao chegar" } });
    render(<OrderExtraActions order={order()} owner={false} onChanged={() => {}} />);
    fireEvent.change(screen.getByLabelText("Observação interna (só a equipe vê)"), { target: { value: "  Ligar ao chegar  " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar observação" }));
    expect(await screen.findByText("Observação salva.")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/orders/o1/internal-note", { note: "Ligar ao chegar" });
  });

  it("sem a observação no detalhe (papel sem acesso) o campo não aparece", () => {
    render(<OrderExtraActions order={order({ internalNote: undefined })} owner={false} onChanged={() => {}} />);
    expect(screen.queryByLabelText("Observação interna (só a equipe vê)")).not.toBeInTheDocument();
  });

  it("estorno travado: só o dono encerra, com motivo e confirmação de segurança", async () => {
    const post = vi.spyOn(FetchHttpClient.prototype, "post").mockResolvedValue({ ok: true, data: true });
    const onChanged = vi.fn();
    const stuck = order({ payment: { status: "ESTORNO_PENDENTE", amountCents: 3000, refundStuck: true } as OrderDetail["payment"] });
    const { rerender } = render(<OrderExtraActions order={stuck} owner={false} onChanged={onChanged} />);
    expect(screen.queryByRole("button", { name: "Encerrar estorno" })).not.toBeInTheDocument();
    rerender(<OrderExtraActions order={stuck} owner onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "Encerrar estorno" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "ACERTADO_COM_CLIENTE" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Encerrar estorno" }).at(-1)!);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(runProtected).toHaveBeenCalledWith("refund", expect.any(Function));
    expect(post).toHaveBeenCalledWith("/api/orders/o1/refund/abandon", { code: "ACERTADO_COM_CLIENTE" }, { headers: { "x-mfa": "ok" } });
  });
});
