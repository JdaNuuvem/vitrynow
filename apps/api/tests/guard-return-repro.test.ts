import { describe, expect, it } from "vitest";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

// SEC-40 — REPRODUÇÃO (Nightingale, 18/11). Sem banco: Fastify puro. Mostra POR QUE toda guarda (`preHandler`) precisa de `return reply...send(...)`.
// Fastify 4.29. Resultado medido (guarda que envia 403 e o handler tem efeito colateral):
//   guarda SEM return + sem onSend / onSend async sem await ........ handler barrado
//   guarda SEM return + onSend async COM await, ou onSend callback lento ... HANDLER RODA depois do 403 + ERR_HTTP_HEADERS_SENT NÃO capturado
//   guarda COM `return reply.code(403).send(...)` ................... barrado em TODOS os casos
// Hoje a API não tem onSend global assíncrono (só o helper de teste, sem await), então a exposição é LATENTE: compressão, assinatura de resposta,
// auditoria de saída ou qualquer plugin com onSend lento a ativa, e aí o 403 vira "executou a ação e respondeu 403" (e derruba o processo por erro não capturado).

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
const slowAsyncOnSend = async (_req: FastifyRequest, _reply: FastifyReply, payload: unknown) => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return payload;
};

async function run(guard: Guard, withSlowOnSend: boolean) {
  const uncaught: string[] = [];
  const onUncaught = (error: Error & { code?: string }) => uncaught.push(error.code ?? error.message);
  process.on("uncaughtException", onUncaught);
  const app = Fastify();
  if (withSlowOnSend) app.addHook("onSend", slowAsyncOnSend);
  let handlerRan = false;
  // O handler devolve `reply` (não envia): assim o teste prova que ELE RODOU sem disparar o ERR_HTTP_HEADERS_SENT que um handler normal causaria
  // (o Vitest trata exceção não capturada como falha da rodada). Num handler que responde `{ ok: true }` o processo recebe esse erro não capturado.
  app.post("/acao", { preHandler: guard }, async (_request, reply) => {
    handlerRan = true; // efeito colateral (criar usuário, trocar modo de impressão...)
    return reply;
  });
  await app.ready();
  const response = await app.inject({ method: "POST", url: "/acao" });
  await new Promise((resolve) => setTimeout(resolve, 80));
  await app.close();
  process.off("uncaughtException", onUncaught);
  return { status: response.statusCode, handlerRan, uncaught };
}

const semReturn: Guard = async (_req, reply) => {
  reply.code(403).send({ error: "proibido" }); // O DEFEITO: não retorna
};
const comReturn: Guard = async (_req, reply) => reply.code(403).send({ error: "proibido" });

describe("SEC-40: guarda que envia sem `return`", () => {
  it("com onSend rápido o Fastify ainda barra o handler (por isso ninguém viu)", async () => {
    const r = await run(semReturn, false);
    expect(r).toMatchObject({ status: 403, handlerRan: false, uncaught: [] });
  });

  it("DEFEITO: com um onSend assíncrono lento o handler RODA depois do 403 (a ação acontece e o cliente vê 403)", async () => {
    const r = await run(semReturn, true);
    expect(r.status).toBe(403);
    expect(r.handlerRan).toBe(true);
  });

  it("CORREÇÃO: `return reply.code(403).send(...)` barra o handler também com onSend lento e sem erro", async () => {
    const r = await run(comReturn, true);
    expect(r).toMatchObject({ status: 403, handlerRan: false, uncaught: [] });
  });
});
