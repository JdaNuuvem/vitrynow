import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportSummary } from "@/core/domain/reports";
import { RelatoriosPage } from "./RelatoriosPage";

const state = vi.hoisted(() => ({
  role: "STAFF" as "OWNER" | "STAFF" | null,
  summary: null as ReportSummary | null,
  hidden: false,
}));
vi.mock("@/core/session/useCurrentRole", () => ({ useCurrentRole: () => state.role }));
vi.mock("@/features/inicio/hooks/useHiddenValues", () => ({ useHiddenValues: () => ({ hidden: state.hidden, toggle: () => {} }) }));
// A seção avançada (API-45) busca dados por conta própria e tem teste próprio (AdvancedReports.test.tsx).
vi.mock("./components/AdvancedReports", () => ({ AdvancedReports: () => null }));
vi.mock("./hooks/useRelatorios", () => ({
  useRelatorios: () => ({ summary: state.summary, range: { from: "2026-11-01", to: "2026-11-18" }, setRange: () => {}, reload: () => {}, loading: false }),
}));

const counts: ReportSummary = {
  from: "2026-11-01", to: "2026-11-18", orderCount: 3, customerCount: 2, openCount: 1, canceledCount: 0,
  byDay: [{ date: "2026-11-12", orderCount: 3 }], byType: { DELIVERY: { count: 3 } },
  topProducts: [{ productName: "Lámen", quantity: 3 }], byDeliverer: [{ delivererName: "Marta", orderCount: 2 }],
};
const full: ReportSummary = {
  ...counts, revenueCents: 2350, averageTicketCents: 783, discountCents: 0, ruleChangedAt: "2026-11-18T00:00:00Z",
  byDay: [{ date: "2026-11-12", orderCount: 3, revenueCents: 2350 }], byType: { DELIVERY: { count: 3, revenueCents: 2350 } },
  topProducts: [{ productName: "Lámen", quantity: 3, revenueCents: 2350 }],
  byDeliverer: [{ delivererName: "Marta", orderCount: 2, revenueCents: 2350 }],
  cashSummary: { sessionCount: 1, suprimentosCents: 1000, sangriasCents: 100 },
};

beforeEach(() => { state.role = "STAFF"; state.summary = counts; state.hidden = false; });

describe("relatório por papel", () => {
  it("renderiza o resumo reduzido inclusive sem caixa e conserva as contagens", () => {
    const { container } = render(<RelatoriosPage />);
    expect(screen.getByText("Aguardando aceite")).toBeInTheDocument();
    expect(screen.getByText("Lámen")).toBeInTheDocument();
    expect(screen.queryByText("Caixa")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/R\$|NaN|undefined/);
  });

  it.each(["STAFF", null] as const)("omite também valores vindos de um backend legado quando o papel é %s", (role) => {
    state.role = role;
    state.summary = full;
    const { container } = render(<RelatoriosPage />);
    expect(screen.queryByText("Caixa")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/R\$|23,50/);
  });

  it("mostra valores completos ao dono e respeita ocultação em gráficos, linhas e tabela", () => {
    state.role = "OWNER";
    state.summary = full;
    const { container, rerender } = render(<RelatoriosPage />);
    expect(screen.getByText("Faturamento sem gorjeta")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Caixa" })).toBeInTheDocument();
    expect(container).toHaveTextContent("R$ 23,50");
    state.hidden = true;
    rerender(<RelatoriosPage />);
    expect(container.innerHTML).not.toMatch(/R\$\s?\d|23,50/); // oculto = "R$ ••••" (SSOT D11): nenhum valor vaza
  });
});
