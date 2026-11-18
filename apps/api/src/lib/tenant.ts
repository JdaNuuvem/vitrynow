import type { FastifyReply } from "fastify";

// Padrão repetido em quase toda rota de recurso-por-loja: buscar por id+storeId e, se não
// achar, responder 404. Centraliza isso em vez de repetir o if em cada arquivo de rota.
// Uso: `const category = await findOwnedOrNotFound(reply, () => prisma.category.findFirst({ where: { id, storeId } }), "categoria não encontrada"); if (!category) return;`
export async function findOwnedOrNotFound<T>(
  reply: FastifyReply,
  finder: () => Promise<T | null>,
  notFoundMessage: string,
): Promise<T | null> {
  const record = await finder();
  if (!record) {
    reply.code(404).send({ error: notFoundMessage });
    return null;
  }
  return record;
}
