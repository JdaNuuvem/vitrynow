import { prisma } from "@meucardapio/db";
import { safeTimeZone } from "./storeTime";

// Fuso da LOJA (`Store.timezone`) para quem precisa do "dia" ou da "hora" dela. Loja sem fuso válido cai no padrão (DEFAULT_STORE_TIMEZONE).
export async function storeTimeZone(storeId: string, db: Pick<typeof prisma, "store"> = prisma): Promise<string> {
  const store = await db.store.findUnique({ where: { id: storeId }, select: { timezone: true } });
  return safeTimeZone(store?.timezone);
}
