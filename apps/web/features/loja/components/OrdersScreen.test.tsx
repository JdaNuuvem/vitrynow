import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrdersScreen } from "./OrdersScreen";

const orders = [{ code: "0123", totalCents: 4500, placedAt: "2026-11-17T14:32:00.000Z" }];
const future = Date.now() + 10 * 60_000;

describe("OrdersScreen: pedidos depois de recarregar (WEB-33b, UI-V-24/25)", () => {
  it("mostra código, hora e total, e diz que não dá para acompanhar, sem 'pedido não existe'", () => {
    render(<OrdersScreen orders={orders} storeName="Boa" />);
    expect(screen.getByText("Pedido #0123")).toBeInTheDocument();
    expect(screen.getByText("R$ 45,00")).toBeInTheDocument();
    expect(screen.getByText("Não é possível acompanhar este pedido por aqui. Fale com a loja.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/não encontr|não existe|telefone/i);
    expect(screen.queryByRole("button")).not.toBeInTheDocument(); // sem Cancelar nem "Conferir pagamento"
  });

  it("pedido em dinheiro ou cartão (sem PIX guardado): a frase 'a loja recebe o pedido' NÃO aparece", () => {
    render(<OrdersScreen orders={orders} storeName="Boa" pendingPix={null} />);
    expect(screen.queryByText(/já pagou/)).not.toBeInTheDocument();
  });

  it("PIX com payload ainda válido para ESSE pedido: acrescenta 'Se você já pagou, a loja recebe o pedido.'", () => {
    render(<OrdersScreen orders={orders} storeName="Boa" pendingPix={{ code: "0123", expiresAt: future }} />);
    expect(screen.getByText("Se você já pagou, a loja recebe o pedido.")).toBeInTheDocument();
  });

  it("PIX guardado de OUTRO pedido, ou já vencido: omite a frase (em dúvida, omitir)", () => {
    const { rerender } = render(<OrdersScreen orders={orders} storeName="Boa" pendingPix={{ code: "0999", expiresAt: future }} />);
    expect(screen.queryByText(/já pagou/)).not.toBeInTheDocument();
    rerender(<OrdersScreen orders={orders} storeName="Boa" pendingPix={{ code: "0123", expiresAt: Date.now() - 1000 }} />);
    expect(screen.queryByText(/já pagou/)).not.toBeInTheDocument();
  });

  it("WhatsApp só se a loja tiver, só com o código do pedido", () => {
    const { rerender } = render(<OrdersScreen orders={orders} storeName="Boa" whatsapp={null} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    rerender(<OrdersScreen orders={orders} storeName="Boa" whatsapp="5521999999999" />);
    expect(screen.getByRole("link", { name: "Falar com a loja no WhatsApp" })).toHaveAttribute("href", "https://wa.me/5521999999999?text=Pedido%20%230123");
  });

  it("sem pedidos: estado vazio normal, sem linha inventada", () => {
    render(<OrdersScreen orders={[]} storeName="Boa" />);
    expect(screen.getByText(/Você ainda não fez pedidos em Boa/)).toBeInTheDocument();
    expect(screen.queryByText(/acompanhar/)).not.toBeInTheDocument();
  });
});
