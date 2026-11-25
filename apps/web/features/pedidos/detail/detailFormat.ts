import type { OrderDetail } from "@/core/domain/orderDetail";
import { formatCents } from "@/shared/format/money";
import { orderLabel } from "@/shared/format/orderCode";
import { whatsappHref as whatsappLink } from "@/shared/format/phone";

// Funções puras do detalhe do pedido (spec 11, regras do Leonardo). Nada aqui envia nada: só monta texto e links
// que a pessoa decide abrir (ligar, WhatsApp, mapa).


// Só existe link de contato com o telefone COMPLETO. Mascarado (`contactMasked`) ou ausente: sem link.
export function canContact(order: Pick<OrderDetail, "customerPhone" | "contactMasked">): boolean {
  // Defesa em profundidade: se o servidor errar a flag, um telefone com máscara ("*", "•") nunca vira link para o número errado.
  return Boolean(order.customerPhone) && !order.contactMasked && !/[*•]/.test(order.customerPhone ?? "");
}

export { telHref } from "@/shared/format/phone";

// WhatsApp abre o chat FORA do app, com o texto "Pedido #0123" e mais nada (sem nome, valor nem endereço).
export function whatsappHref(phone: string, code: string): string {
  return whatsappLink(phone, orderLabel(code)) ?? "";
}

// Mapa externo, aberto só por ação da pessoa (decisão do Leonardo, reversível).
export function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// Frase de pagamento (spec 11 §3.1, Leonardo §5). Interino: o servidor ainda não manda a frase pronta, então
// ela é montada aqui com os mesmos textos do tíquete. Nunca mostra id do provedor, token nem dado de cartão.
export type PaymentView = { lines: string[]; highlight: string | null };

const CARD_LABEL: Record<string, string> = { CREDITO: "crédito", DEBITO: "débito", VR: "VR", VA: "VA" };

export function paymentView(order: Pick<OrderDetail, "paymentMethod" | "payment" | "totalCents" | "changeForCents">): PaymentView {
  const total = formatCents(order.totalCents);
  const status = order.payment?.status;

  if (order.payment?.refundPending || status === "ESTORNO_PENDENTE") return { lines: ["Estorno em andamento"], highlight: null };
  if (status === "REEMBOLSADO") return { lines: ["Estornado"], highlight: null };

  if (order.paymentMethod === "PIX" || (!order.paymentMethod && order.payment)) {
    if (status === "APROVADO") return { lines: ["Pago online (PIX)"], highlight: null };
    if (status === "PENDENTE" || status === "EM_ANALISE") return { lines: ["Aguardando o pagamento"], highlight: null };
    if (status === "REJEITADO" || status === "EXPIRADO" || status === "CANCELADO") return { lines: ["Pagamento não concluído"], highlight: null };
    return { lines: ["PIX (conferir na hora)"], highlight: null };
  }

  if (order.paymentMethod === "DINHEIRO") {
    const lines = [`Cobrar ${total} em dinheiro`];
    // Troco: o motoboy precisa saber quanto levar. Troco menor que o total não existe (a API recusa).
    if (order.changeForCents && order.changeForCents > order.totalCents) {
      const back = order.changeForCents - order.totalCents;
      return { lines, highlight: `Troco para ${formatCents(order.changeForCents)} → levar ${formatCents(back)}` };
    }
    return { lines, highlight: null };
  }

  if (order.paymentMethod && CARD_LABEL[order.paymentMethod]) {
    return { lines: [`Cobrar ${total} no cartão (${CARD_LABEL[order.paymentMethod]})`], highlight: null };
  }
  return { lines: ["Forma de pagamento não informada"], highlight: null };
}

export type ValueRow = { label: string; cents: number; sign?: "minus"; note?: string };

// Valores na ordem do tíquete: subtotal, desconto, taxa, gorjeta, total. Desconto, taxa e gorjeta só aparecem se houver.
export function valueRows(order: Pick<OrderDetail, "subtotalCents" | "discountCents" | "deliveryFeeCents" | "tipCents" | "totalCents">): ValueRow[] {
  const rows: ValueRow[] = [{ label: "Subtotal", cents: order.subtotalCents }];
  if (order.discountCents > 0) rows.push({ label: "Desconto", cents: order.discountCents, sign: "minus" });
  if (order.deliveryFeeCents > 0) rows.push({ label: "Taxa de entrega", cents: order.deliveryFeeCents });
  if (order.tipCents > 0) rows.push({ label: "Gorjeta", cents: order.tipCents, note: "fora do faturamento" });
  rows.push({ label: "Total", cents: order.totalCents });
  return rows;
}

const ROLE_TEXT: Record<string, string> = { OWNER: "pelo dono", STAFF: "pela equipe", CUSTOMER: "pelo cliente", SYSTEM: "pelo sistema" };

// Quem fez, sempre como PAPEL (a conta só tem e-mail e o e-mail nunca aparece).
export function actorText(by: string): string {
  return ROLE_TEXT[by] ?? "pelo sistema";
}
