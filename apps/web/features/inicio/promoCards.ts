export type PromoCardConfig = {
  id: string;
  tone: "info" | "neutral";
  title: string;
  description: string;
  badge: string;
  action: { kind: "link"; href: string } | { kind: "upgrade" };
};

export const PROMO_CARDS: readonly PromoCardConfig[] = [
  {
    id: "pix",
    tone: "info",
    title: "Pagamentos online com Pix",
    description: "Receba por Pix direto no pedido, com confirmação automática do pagamento. Adesão opcional.",
    badge: "Pix",
    action: { kind: "link", href: "/dashboard/conta" },
  },
  {
    id: "fiscal",
    tone: "neutral",
    title: "Se adeque à reforma tributária",
    description: "Elimine o risco fiscal do seu negócio com um sistema de emissão de notas fiscais ilimitadas.",
    badge: "NFC-e",
    action: { kind: "upgrade" },
  },
];
