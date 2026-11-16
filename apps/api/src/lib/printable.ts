import type { PrintableOrder } from "@meucardapio/shared-types";
import { prisma } from "@meucardapio/db";

// Monta o tíquete pronto para impressão a partir do pedido — equivalente ao textSaleNew
// do original, mas como JSON estruturado (o print-client renderiza, não o servidor em HTML).
export async function buildPrintableOrder(orderId: string): Promise<PrintableOrder | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { store: true, items: { include: { additionals: true } } },
  });
  if (!order) return null;

  return {
    orderId: order.id,
    code: order.code,
    type: order.type,
    storeName: order.store.name,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    address: order.address,
    notes: order.notes,
    totalCents: order.totalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    tipCents: order.tipCents,
    paymentMethod: order.paymentMethod,
    createdAt: order.createdAt.toISOString(),
    items: order.items.map((item) => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      notes: item.notes,
      additionals: item.additionals.map((a) => ({ name: a.name, priceCents: a.priceCents })),
    })),
  };
}
