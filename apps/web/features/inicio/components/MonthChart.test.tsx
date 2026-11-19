import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildMonthSeries } from "../services/inicioMetrics";
import { MonthChart } from "./MonthChart";

describe("evolução diária", () => {
  it("preserva o valor zero e distingue dias ausentes do futuro no calendário da loja", () => {
    const series = buildMonthSeries([
      { date: "2026-11-01", orderCount: 1, revenueCents: 0 },
    ], new Date("2026-11-03T01:15:00Z"));
    expect(series).toEqual([
      { date: "2026-11-01", orderCount: 1, revenueCents: 0 },
      { date: "2026-11-02", orderCount: null, revenueCents: null },
    ]);
  });

  it("mantém dias de meses diferentes, informa a unidade e oculta valores também na tabela", () => {
    const series = [
      { date: "2026-10-01", orderCount: 2, revenueCents: 1234 },
      { date: "2026-11-01", orderCount: 1, revenueCents: 9999 },
    ];
    const { rerender } = render(<MonthChart series={series} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2026-10" } });
    expect(screen.getByRole("radio", { name: /01\/10\/2026, R\$ 12,34/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Pedidos" }));
    expect(screen.getByRole("radio", { name: /2 pedidos/ })).toBeChecked();
    fireEvent.click(screen.getByText("Ver valores por dia"));
    expect(within(screen.getByRole("table")).getByText("R$ 12,34")).toBeInTheDocument();

    rerender(<MonthChart series={series} hideMoney />);
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Valor dos pedidos" })).not.toBeInTheDocument();
  });
});
