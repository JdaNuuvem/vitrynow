import { printableOrderSchema, sanitizeText, TICKET_SCHEMA_VERSION, type PrintableOrder, type TicketPaymentStatus } from "@meucardapio/shared-types";
import type { PaymentStatus } from "@meucardapio/db";
import { prisma } from "@meucardapio/db";

// API-49 / ADR-0004 D4-6: de novo no renderizador (dados antigos podem ter controle): nada de byte de comando no tíquete.
const clean = (value: string | null | undefined, multiline = false): string | null => (value == null ? null : sanitizeText(value, { multiline }));

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

// "Nada a cobrar" (API-66): total ZERO e nenhuma cobrança possível. Pagamento aprovado, pendente, em análise, estornado ou contestado
// significa que dinheiro está em jogo; só pagamento morto (rejeitado, expirado, cancelado) ou ausência de pagamento libera.
// Total zero com cupom nasce sem Payment (FUNC-02); um total > 0 NUNCA é "nada a cobrar", seja qual for o desconto.
const DEAD_PAYMENT: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>(["REJEITADO", "EXPIRADO", "CANCELADO"]);
export function nothingToCharge(order: { totalCents: number }, payment: { status: PaymentStatus } | null | undefined): boolean {
  if (order.totalCents !== 0) return false;
  return !payment || DEAD_PAYMENT.has(payment.status);
}

export const tableLabelOf = (label: string) => `Mesa ${label}`;

// API-23 — mesa, rodada e quem pediu. Rodada = posição do pedido entre os pedidos NÃO cancelados da mesa ainda NÃO recebidos (paidAt nulo): recomeça em 1 depois
// que a mesa é recebida (API-24 grava paidAt). "Quem pediu" = nome informado, ou "Aparelho N" pela ordem de chegada dos aparelhos na mesa; nunca sai o token.
async function tableRoundInfo(order: { id: string; storeId: string; tableId: string | null; customerName: string | null; deviceTokenHash: string | null; table: { label: string } | null }) {
  const open = await prisma.order.findMany({
    where: { storeId: order.storeId, tableId: order.tableId, paidAt: null, status: { not: "CANCELADO" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, deviceTokenHash: true },
  });
  const index = open.findIndex((o) => o.id === order.id);
  const devices: string[] = [];
  for (const o of open) if (o.deviceTokenHash && !devices.includes(o.deviceTokenHash)) devices.push(o.deviceTokenHash);
  const deviceNo = order.deviceTokenHash ? devices.indexOf(order.deviceTokenHash) + 1 : 0;
  return {
    tableLabel: tableLabelOf(order.table!.label),
    round: index >= 0 ? index + 1 : open.length + 1, // pedido cancelado ou já recebido (2ª via): fora da lista, vai para o fim
    requestedBy: order.customerName ?? (deviceNo > 0 ? `Aparelho ${deviceNo}` : null),
  };
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
    include: { store: true, payment: true, coupon: true, table: { select: { label: true } }, items: { include: { additionals: true, options: true } } },
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
      nothingToCharge: false, // o aviso tem total 0 só porque não leva valores: NUNCA vira "sem cobrança"
      cancelNotice: true,
      reprintCount: 0,
      printedAtOriginal: options.printedAtOriginal ? options.printedAtOriginal.toISOString() : null,
      createdAt: order.createdAt.toISOString(),
      ...(order.table ? { tableLabel: tableLabelOf(order.table.label) } : {}),
      items: [],
    });
  }

  const mesa = order.tableId && order.table ? await tableRoundInfo(order) : null;

  return printableOrderSchema.parse({
    ticketSchemaVersion: TICKET_SCHEMA_VERSION,
    orderId: order.id,
    code: order.code,
    type: order.type,
    storeName: clean(order.store.name) ?? "",
    customerName: clean(order.customerName),
    customerPhone: order.customerPhone,
    // Endereço só quando o tipo pede (retirada/mesa não levam endereço — D4-2, mínimo necessário).
    address: order.type === "DELIVERY" ? clean(order.address, true) : null,
    notes: clean(order.notes, true),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    couponCode: order.coupon?.code ?? null,
    totalCents: order.totalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    tipCents: order.tipCents,
    changeForCents: order.changeForCents ?? null,
    paymentMethod: order.paymentMethod,
    paymentStatus: ticketPaymentStatus(order.payment),
    nothingToCharge: nothingToCharge(order, order.payment),
    ...(mesa ? { tableLabel: mesa.tableLabel, round: mesa.round, requestedBy: mesa.requestedBy } : { tableLabel: null }),
    reprintCount: options.reprintCount ?? 0,
    printedAtOriginal: options.printedAtOriginal ? options.printedAtOriginal.toISOString() : null,
    cancelNotice: options.cancelNotice ?? false,
    customerRemoved: order.anonymizedAt !== null,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => {
      const variation = item.options.find((option) => option.priceMode === "BASE");
      return {
        productName: clean(variation ? `${item.productName} — ${variation.name}` : item.productName) ?? "",
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        notes: clean(item.notes, true),
        // O cliente de impressão já soma adicionais por unidade. A variação BASE está no preço do item.
        additionals: [
          ...item.additionals.map((entry) => ({ name: clean(entry.name) ?? "", priceCents: entry.priceCents })),
          ...item.options.filter((option) => option.priceMode === "SUM").map((option) => ({
            name: clean(`${option.quantity > 1 ? `${option.quantity}× ` : ""}${option.name}`) ?? "",
            priceCents: option.priceCents * option.quantity,
          })),
        ],
      };
    }),
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
    nothingToCharge: false,
    createdAt: now.toISOString(),
    items: [],
  });
}
