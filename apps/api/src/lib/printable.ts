import { printableOrderSchema, TICKET_SCHEMA_VERSION, type PrintableOrder, type TicketPaymentStatus } from "@meucardapio/shared-types";
import type { PaymentStatus } from "@meucardapio/db";
import { prisma } from "@meucardapio/db";

// `PAGO` é a única prova de "NÃO COBRAR" no tíquete (ADR-0004 §7). Só sai de pagamento APROVADO — estado que o
// webhook verificado (assinatura, valor, moeda e referência conferidos; API-03) é o único a gravar. Tudo o mais é
// A_COBRAR, inclusive EM_ANALISE, PENDENTE, ESTORNO_PENDENTE e CONTESTADO, e inclusive pedido manual com PIX
// presencial (não tem registro de pagamento: paymentMethod=PIX sozinho NUNCA vira PAGO).
export function ticketPaymentStatus(payment: { status: PaymentStatus } | null | undefined): TicketPaymentStatus {
  if (!payment) return "A_COBRAR";
  if (payment.status === "APROVADO") return "PAGO";
  if (payment.status === "REEMBOLSADO") return "ESTORNADO";
  return "A_COBRAR";
}

export type PrintableOptions = {
  // Preenchidos pela fila de impressão (API-12): 2ª via e aviso de cancelamento.
  reprintCount?: number;
  printedAtOriginal?: Date | null;
  cancelNotice?: boolean;
};

// Monta o tíquete pronto para impressão a partir do pedido — equivalente ao textSaleNew do original,
// mas como JSON estruturado (o print-client renderiza, não o servidor em HTML).
// A saída passa pelo schema Zod: campo fora do contrato é descartado (nada vaza por acidente).
export async function buildPrintableOrder(orderId: string, options: PrintableOptions = {}): Promise<PrintableOrder | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { store: true, payment: true, coupon: true, items: { include: { additionals: true } } },
  });
  if (!order) return null;

  // Aviso de cancelamento: só o necessário para a cozinha reconhecer o tíquete que já saiu — sem itens, valores,
  // contato nem endereço (ADR-0004 §6; contrato do cliente: "imprime só o aviso").
  if (options.cancelNotice) {
    return printableOrderSchema.parse({
      ticketSchemaVersion: TICKET_SCHEMA_VERSION,
      orderId: order.id,
      code: order.code,
      type: order.type,
      storeName: order.store.name,
      customerName: null,
      customerPhone: null,
      address: null,
      notes: null,
      totalCents: 0,
      deliveryFeeCents: 0,
      tipCents: 0,
      paymentMethod: null,
      paymentStatus: "A_COBRAR",
      cancelNotice: true,
      reprintCount: 0,
      printedAtOriginal: options.printedAtOriginal ? options.printedAtOriginal.toISOString() : null,
      createdAt: order.createdAt.toISOString(),
      items: [],
    });
  }

  return printableOrderSchema.parse({
    ticketSchemaVersion: TICKET_SCHEMA_VERSION,
    orderId: order.id,
    code: order.code,
    type: order.type,
    storeName: order.store.name,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    // Endereço só quando o tipo pede (retirada/mesa não levam endereço — D4-2, mínimo necessário).
    address: order.type === "DELIVERY" ? order.address : null,
    notes: order.notes,
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    couponCode: order.coupon?.code ?? null,
    totalCents: order.totalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    tipCents: order.tipCents,
    changeForCents: order.changeForCents ?? null,
    paymentMethod: order.paymentMethod,
    paymentStatus: ticketPaymentStatus(order.payment),
    tableLabel: null,
    reprintCount: options.reprintCount ?? 0,
    printedAtOriginal: options.printedAtOriginal ? options.printedAtOriginal.toISOString() : null,
    cancelNotice: options.cancelNotice ?? false,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      notes: item.notes,
      additionals: item.additionals.map((a) => ({ name: a.name, priceCents: a.priceCents })),
    })),
  });
}

// Tíquete do job TEST (teste de impressora): o MÍNIMO e FICTÍCIO — nenhum dado de loja, cliente ou pedido, e NADA que
// pareça cobrança: sem `paymentStatus`, sem forma de pagamento, sem itens e com os totais obrigatórios do schema em zero
// (ADR-0004 §8 itens 2 e 11). O cliente imprime o próprio tíquete de teste ("TESTE DE IMPRESSÃO") e ignora campos de pedido;
// a regra fail-safe do cliente ("sem prova de pagamento, COBRAR NO CAIXA") vale só para pedidos reais.
export function buildTestTicket(jobId: string, now: Date): PrintableOrder {
  return printableOrderSchema.parse({
    ticketSchemaVersion: TICKET_SCHEMA_VERSION,
    orderId: `teste-${jobId}`,
    code: "TESTE",
    type: "BALCAO",
    storeName: "Teste de impressora",
    customerName: null,
    customerPhone: null,
    address: null,
    notes: null,
    totalCents: 0,
    deliveryFeeCents: 0,
    tipCents: 0,
    paymentMethod: null,
    createdAt: now.toISOString(),
    items: [],
  });
}
