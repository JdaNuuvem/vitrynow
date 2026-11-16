import { prisma } from "@meucardapio/db";

// Código sequencial legível por loja (ex. "0001", "0002", ...), análogo ao NNN-cod do original
// mas gerado por nós — não depende de nenhum serviço externo.
export async function nextOrderCode(storeId: string): Promise<string> {
  const last = await prisma.order.findFirst({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    select: { code: true },
  });
  const nextNumber = last ? Number(last.code) + 1 : 1;
  return String(nextNumber).padStart(4, "0");
}
