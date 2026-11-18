import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { revalidateConfig, scheduleMenuRevalidation } from "../lib/menuRevalidation";

// Gancho central da vitrine (API-58): depois de QUALQUER escrita bem-sucedida do painel que muda o que o cliente vê,
// pede a revalidação da loja. Central (e não um `if` em cada rota) para que rota nova de catálogo não esqueça.
// Rotas fora do painel (webhook de pagamento, jobs de assinatura) chamam `scheduleMenuRevalidation` direto.

// Padrões de rota (como registrados no Fastify) que mudam o cardápio público.
const MENU_AFFECTING: RegExp[] = [
  /^\/api\/catalog\//, // categorias, produtos, adicionais, grupos de opções, esgotado, ordem
  /^\/api\/store\/(settings|availability|hours|status|prep-times)$/, // dados da loja, horário, pausa, prazo de preparo
];

export const isMenuAffectingRoute = (method: string, url: string) =>
  method === "POST" && MENU_AFFECTING.some((pattern) => pattern.test(url));

// Outro envio pode estar em andamento: tenta de novo por ~1,2 s antes de deixar para o intervalo de 3 s do job. Repete em DOIS casos:
//  1) o job "skipped" (sobreposição local: outro envio do mesmo processo ainda em voo);
//  2) o job terminou "ok" mas NÃO enviou esta loja: o lock da fila estava com outra execução (`pg_try_advisory_xact_lock` não espera) ou o envio
//     em voo perdeu o `deleteMany` por `requestedAt` mais novo. A linha desta mudança continua pendente e vencida: sem esta checagem ela só
//     sairia no próximo ciclo (que nem existe quando o job periódico está desligado, como nos testes).
async function kick(app: FastifyInstance, slug: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await app.jobs.run("menu.revalidate");
    if (result.status !== "skipped") {
      const pending = await prisma.menuRevalidation.count({ where: { slug, nextAttemptAt: { lte: new Date() } } });
      if (pending === 0) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

const menuRevalidationPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode < 200 || reply.statusCode >= 300) return;
    if (!isMenuAffectingRoute(request.method, request.routeOptions?.url ?? "")) return;
    const storeId = (request.user as { storeId?: string } | null | undefined)?.storeId;
    if (!storeId || !revalidateConfig()) return;
    try {
      const slug = (await prisma.store.findUnique({ where: { id: storeId }, select: { slug: true } }))?.slug;
      if (slug && (await scheduleMenuRevalidation(storeId))) {
        // Envio imediato: o job (a cada 3 s) é só a rede de segurança para reenvio.
        void kick(app, slug).catch((error) => request.log.warn({ err: error }, "menu.revalidate.kick_failed"));
      }
    } catch (error) {
      // Falha ao agendar nunca derruba a resposta: a alteração já foi gravada e o TTL do ISR cobre.
      request.log.warn({ err: error }, "menu.revalidate.schedule_failed");
    }
  });
};

export default fp(menuRevalidationPlugin, { name: "menu-revalidation", dependencies: ["jobs"] });
