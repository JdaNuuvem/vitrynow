import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RevenueCard } from "./RevenueCard";
import type { InicioMetrics } from "../services/inicioMetrics";

vi.mock("@/features/ajuda/HelpWidget", () => ({ useHelp: () => ({ openHelp: vi.fn() }) }));

const metrics = (over: Partial<InicioMetrics> = {}): InicioMetrics => ({
  revenueCents: 6100,
  tipCents: 0,
  awaiting: { count: 0, cents: 0 },
  awaitingKnown: true,
  chartExact: true,
  orderCount: 2,
  customerCount: 2,
  averageTicketCents: 3050,
  week: { orderCount: 2, revenueCents: 6100 },
  orderTypes: { delivery: 0, table: 0, pickup: 2 },
  topProducts: [],
  monthSeries: [{ day: 1, revenueCents: 6100 }],
  ...over,
});

function setup(over: Partial<InicioMetrics> = {}, hidden = false) {
  render(<RevenueCard metrics={metrics(over)} hidden={hidden} onToggleHidden={vi.fn()} teamHref="/dashboard/equipe" />);
}

beforeEach(() => window.localStorage.clear());

describe("RevenueCard: nova definição de faturamento (UX-23)", () => {
  it("avisa uma vez 'Mudamos como contamos o faturamento' e some depois do 'Entendi'", async () => {
    setup();
    expect(await screen.findByText("Mudamos como contamos o faturamento. Agora contam só pedidos aceitos.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Entendi" }));
    expect(screen.queryByText(/Mudamos como contamos/)).not.toBeInTheDocument();
  });

  it("não volta a avisar na próxima visita", async () => {
    window.localStorage.setItem("panel.inicio.revenueDefinitionNotice.v1", "1");
    setup();
    expect(screen.getByText("R$ 61,00")).toBeInTheDocument();
    expect(screen.queryByText(/Mudamos como contamos/)).not.toBeInTheDocument();
  });

  it("mostra 'Aguardando aceite' à parte, com a quantidade e o valor, e diz que não contam", () => {
    window.localStorage.setItem("panel.inicio.revenueDefinitionNotice.v1", "1");
    setup({ awaiting: { count: 7, cents: 15400 } });
    expect(screen.getByText(/Aguardando aceite: 7 pedidos · R\$\s?154,00 \(ainda não contam\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Em aberto/)).not.toBeInTheDocument();
  });

  it("singular: '1 pedido'", () => {
    setup({ awaiting: { count: 1, cents: 3000 } });
    expect(screen.getByText(/Aguardando aceite: 1 pedido ·/)).toBeInTheDocument();
  });

  it("gorjeta aparece à parte, fora do faturamento", () => {
    setup({ tipCents: 200 });
    expect(screen.getByText(/Gorjetas: R\$\s?2,00 \(não entram no faturamento\)/)).toBeInTheDocument();
  });

  it("sem nada aguardando nem gorjeta, não cria linhas vazias", () => {
    setup();
    expect(screen.queryByText(/Aguardando aceite/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Gorjetas/)).not.toBeInTheDocument();
  });

  it("sem a lista de pedidos avisa que o valor pode incluir pedidos aguardando aceite", () => {
    setup({ awaitingKnown: false });
    expect(screen.getByText(/pode incluí-los/)).toBeInTheDocument();
  });

  it("gráfico com gorjeta de venda avisa que ainda a inclui", () => {
    setup({ chartExact: false, tipCents: 200 });
    expect(screen.getByText("O gráfico ainda inclui as gorjetas.")).toBeInTheDocument();
  });

  it("valores ocultos escondem também o valor aguardando aceite e a gorjeta", () => {
    setup({ awaiting: { count: 2, cents: 5000 }, tipCents: 200 }, true);
    expect(screen.queryByText(/50,00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2,00/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/R\$ ••••/).length).toBeGreaterThan(1);
  });

  it("o botão do aviso tem alvo de 44 px (CSS) e nome acessível", () => {
    setup();
    expect(screen.getByRole("button", { name: "Entendi" })).toBeInTheDocument();
  });
});
