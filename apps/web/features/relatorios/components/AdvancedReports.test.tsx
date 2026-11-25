import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdvancedReport } from "@/core/domain/reports";
import type { PanelServices } from "@/core/services/PanelServices";
import { PanelServicesProvider } from "@/core/services/PanelServices";
import { AdvancedReports } from "./AdvancedReports";

const openUpgrade = vi.fn();
vi.mock("@/features/planos/FeatureUpgradeContext", () => ({ useFeatureUpgrade: () => ({ openUpgrade }) }));

const report: AdvancedReport = {
  fromDate: "2026-11-10", toDate: "2026-11-16", timeZone: "America/Sao_Paulo",
  comparison: {
    previous: { fromDate: "2026-11-03", toDate: "2026-11-09" },
    revenueCents: { current: 6000, previous: 1000, changePercent: 500 },
    orderCount: { current: 3, previous: 1, changePercent: 200 },
    averageTicketCents: { current: 2000, previous: 1000, changePercent: 100 },
    canceledCount: { current: 0, previous: 2, changePercent: -100 },
  },
  byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, orderCount: hour === 20 ? 2 : 0, revenueCents: hour === 20 ? 3000 : 0 })),
  byWeekday: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, orderCount: i === 5 ? 2 : 0, revenueCents: i === 5 ? 3000 : 0 })),
  byStaff: [{ userId: "u1", email: "dono@loja.com", acceptedOrders: 1, acceptedRevenueCents: 3000, tablesReceived: 0, tablesRevenueCents: 0 }],
  customers: { identified: 2, new: 1, returning: 1, returningPercent: 50, boughtTwiceOrMoreInPeriod: 1, newRevenueCents: 3000, returningRevenueCents: 3000 },
};

function renderWith(getAdvanced: () => Promise<unknown>, hidden = false) {
  const services = { reports: { getAdvanced, getSummary: vi.fn() } } as unknown as PanelServices;
  return render(<PanelServicesProvider services={services}><AdvancedReports range={{ from: "2026-11-10", to: "2026-11-16" }} hidden={hidden} /></PanelServicesProvider>);
}

describe("relatórios avançados (API-45)", () => {
  it("mostra comparação, pico de hora e de dia, equipe e clientes", async () => {
    renderWith(async () => ({ ok: true, data: report }));
    expect(await screen.findByText("Comparado a 03/11/2026 – 09/11/2026")).toBeInTheDocument();
    expect(screen.getByText(/▲ 500% · antes R\$\s10,00/)).toBeInTheDocument();
    expect(screen.getByText("20h", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("Sáb", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText("dono@loja.com")).toBeInTheDocument();
    expect(screen.getByText("1 · 50%")).toBeInTheDocument();
  });

  it("menos cancelamento é bom (seta para baixo em verde)", async () => {
    renderWith(async () => ({ ok: true, data: report }));
    const cancel = (await screen.findByText(/▼ 100%/));
    expect(cancel.className).toContain("relatorios__up");
  });

  it("valores ocultos escondem o dinheiro e mantêm as contagens", async () => {
    const { container } = renderWith(async () => ({ ok: true, data: report }), true);
    await screen.findByText("dono@loja.com");
    expect(container.innerHTML).not.toMatch(/R\$\s?\d/); // nenhum valor vaza
    expect(screen.getAllByText("R$ ••••").length).toBeGreaterThan(0); // texto único de oculto (SSOT D11)
  });

  it("fora do PRO: convite em vez dos dados, abrindo o aviso de planos", async () => {
    renderWith(async () => ({ ok: false, status: 402, code: "FEATURE_LOCKED", error: "Este recurso não está disponível no seu plano." }));
    const button = await screen.findByRole("button", { name: "Conhecer o plano" });
    button.click();
    await waitFor(() => expect(openUpgrade).toHaveBeenCalled());
    expect(screen.queryByText("dono@loja.com")).not.toBeInTheDocument();
  });
});
