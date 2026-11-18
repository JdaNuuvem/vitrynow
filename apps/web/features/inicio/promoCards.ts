// Cartões promocionais do Início. Regra (ogilvy\validacao-inicio-promos.md §3): cartão que promete
// algo só vai ao ar com um GATE ("libera quando") e um teste. Os cartões NÃO foram apagados: ficam
// aqui, fechados, e reaparecem quando o recurso existir.

// "B1": PIX por loja (Mercado Pago da própria loja), depende de API-07 e WEB-06 em main.
// "NFC_E": emissão de nota fiscal (hoje P2) e revisão de contador.
export type PromoGate = "B1" | "NFC_E";

export type PromoGates = Record<PromoGate, boolean>;

// Tudo fechado: nenhum dos dois recursos existe. Mude aqui SÓ quando o gate do cartão valer.
export const PROMO_GATES: PromoGates = { B1: false, NFC_E: false };

export type PromoCardConfig = {
  id: string;
  tone: "info" | "neutral";
  title: string;
  description: string;
  badge: string;
  action: { kind: "link"; href: string } | { kind: "upgrade" };
  requires: PromoGate;
};

export const PROMO_CARDS: readonly PromoCardConfig[] = [
  {
    // O texto antigo ("Receba por Pix direto no pedido, com confirmação automática...") era falso: o PIX
    // cai na conta da PLATAFORMA. Este é o texto aprovado pela Ogilvy para quando o B1 existir; sem
    // "confirmação automática" até o webhook e o QA do PIX.
    id: "pix",
    tone: "info",
    title: "Receba PIX na sua conta do Mercado Pago",
    description: "O PIX dos seus clientes cai direto na sua conta do Mercado Pago. As taxas são cobradas pelo Mercado Pago, conforme as regras dele.",
    badge: "Pix",
    action: { kind: "link", href: "/dashboard/pagamentos" },
    requires: "B1",
  },
  {
    // Texto antigo reprovado ("Elimine o risco fiscal... notas fiscais ilimitadas"): promete nota fiscal
    // que não existe e uma alegação legal absoluta. Fica fechado até existir NFC-e e revisão de contador;
    // a frase "elimine o risco fiscal" nunca volta.
    id: "fiscal",
    tone: "neutral",
    // Sem texto aprovado ainda (a Ogilvy só aprovou o do PIX). Marcador VISÍVEL de propósito: se alguém
    // abrir o gate sem o texto, o erro aparece na tela em vez de voltar uma promessa nunca aprovada.
    title: "Nota fiscal (texto pendente)",
    description: "Texto a ser aprovado pela Ogilvy antes de abrir este gate.",
    badge: "NFC-e",
    action: { kind: "upgrade" },
    requires: "NFC_E",
  },
];

export type PromoContext = {
  // Com o Mercado Pago já conectado o cartão de PIX some (não há o que oferecer).
  mercadoPagoConnected?: boolean;
};

export function visiblePromoCards(
  gates: PromoGates = PROMO_GATES,
  context: PromoContext = {},
  cards: readonly PromoCardConfig[] = PROMO_CARDS,
): PromoCardConfig[] {
  return cards.filter((card) => {
    if (!gates[card.requires]) return false;
    if (card.id === "pix" && context.mercadoPagoConnected) return false;
    return true;
  });
}
