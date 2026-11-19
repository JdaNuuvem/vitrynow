import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InicioPage } from "./InicioPage";
import { PROMO_CARDS, PROMO_GATES, visiblePromoCards, type PromoGates } from "./promoCards";

// Páginas e provedores de fora não importam aqui: o que se prova é o texto que o dono VÊ no Início.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/planos/FeatureUpgradeContext", () => ({ useFeatureUpgrade: () => ({ openUpgrade: vi.fn() }) }));
vi.mock("@/features/planos/PlanStatusBanner", () => ({ PlanStatusBanner: () => null }));
vi.mock("./components/StoreOperations", () => ({ StoreOperations: () => null }));
vi.mock("./components/RevenueCard", () => ({ RevenueCard: () => null }));
vi.mock("./components/TopProductsCard", () => ({ TopProductsCard: () => null }));
vi.mock("./components/OrderTypesCard", () => ({ OrderTypesCard: () => null }));
vi.mock("./components/CurrentOrdersCard", () => ({ CurrentOrdersCard: () => null }));
vi.mock("./hooks/useHiddenValues", () => ({ useHiddenValues: () => ({ hidden: false, toggle: vi.fn() }) }));
vi.mock("./hooks/useInicioData", () => ({
  useInicioData: () => {
    const loading = { data: null, error: null, updatedAt: null, retry: vi.fn() };
    return { month: loading, week: loading, open: loading, waiting: loading, legacyOrders: loading };
  },
}));

const closed: PromoGates = { B1: false, NFC_E: false };

// Frases que NUNCA podem aparecer enquanto os recursos não existem (ogilvy\validacao-inicio-promos.md §3).
const FORBIDDEN = ["NFC-e", "reforma tributária", "risco fiscal", "Pix direto", "notas fiscais ilimitadas", "confirmação automática", "25%"];

describe("Início: nenhuma promessa de recurso que não existe (UX-22)", () => {
  it("com os gates de hoje, o DOM do Início não contém nenhuma frase proibida", () => {
    const { container } = render(<InicioPage />);
    const text = container.textContent ?? "";
    for (const phrase of FORBIDDEN) expect(text, `não pode conter "${phrase}"`).not.toContain(phrase);
  });

  it("e não desenha cartão promocional algum", () => {
    const { container } = render(<InicioPage />);
    expect(container.querySelectorAll(".inicio-promo")).toHaveLength(0);
  });

  it("os gates de hoje estão todos fechados", () => {
    expect(PROMO_GATES).toEqual(closed);
    expect(visiblePromoCards()).toEqual([]);
  });
});

describe("visiblePromoCards: reaparece sozinho quando o recurso existir", () => {
  it("todo cartão tem um gate declarado", () => {
    for (const card of PROMO_CARDS) expect(["B1", "NFC_E"]).toContain(card.requires);
  });

  it("abrir B1 mostra só o cartão do PIX; abrir NFC_E mostra só o fiscal", () => {
    expect(visiblePromoCards({ B1: true, NFC_E: false }).map((c) => c.id)).toEqual(["pix"]);
    expect(visiblePromoCards({ B1: false, NFC_E: true }).map((c) => c.id)).toEqual(["fiscal"]);
  });

  it("com o Mercado Pago já conectado o cartão do PIX some, mesmo com o gate aberto", () => {
    expect(visiblePromoCards({ B1: true, NFC_E: false }, { mercadoPagoConnected: true })).toEqual([]);
  });

  it("o texto novo do PIX é o aprovado: conta do Mercado Pago, sem 'direto' falso nem confirmação automática", () => {
    const pix = PROMO_CARDS.find((c) => c.id === "pix");
    expect(pix?.title).toBe("Receba PIX na sua conta do Mercado Pago");
    expect(pix?.description).not.toMatch(/confirmação automática|adesão opcional|Pix direto/i);
    expect(pix?.action).toEqual({ kind: "link", href: "/dashboard/pagamentos" });
  });

  it("o cartão fiscal NÃO tem mais a alegação absoluta nem a promessa de notas ilimitadas", () => {
    const fiscal = PROMO_CARDS.find((c) => c.id === "fiscal");
    expect(`${fiscal?.title} ${fiscal?.description}`).not.toMatch(/risco fiscal|ilimitad|reforma tribut/i);
  });

  it("se alguém abrir um gate sem texto aprovado, o marcador de pendência aparece (não uma promessa antiga)", () => {
    const [fiscal] = visiblePromoCards({ B1: false, NFC_E: true });
    expect(fiscal.title).toContain("texto pendente");
  });
});
