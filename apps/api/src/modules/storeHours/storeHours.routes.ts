import type { FastifyPluginAsync } from "fastify";
import { busyRequestSchema, storeStatusActionSchema, updatePrepTimesSchema, updateStoreHoursSchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import type { StoreHoursService } from "./storeHours.service";

// Painel: horário de funcionamento (grade, exceções, corte) e controles do dia a dia (pausar, fechar por hoje).
// "Desligar até eu ligar" continua em POST /api/store/availability (acceptingOrders).
export function buildStoreHoursRoutes(service: StoreHoursService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);

    app.get("/api/store/hours", { preHandler: app.requirePanelAuth }, async (request) => {
      return { hours: await service.get(request.user.storeId) };
    });

    app.post("/api/store/hours", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
      const parsed = updateStoreHoursSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Horário inválido.", code: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return { hours: await service.saveSchedule(request.user, parsed.data.schedule) };
    });

    // "Minha loja → Atendimento": tempo médio de preparo por modalidade (5 a 240 min; null = sem previsão).
    app.post("/api/store/prep-times", { preHandler: [app.requirePanelAuth, app.requireOwner] }, async (request, reply) => {
      const parsed = updatePrepTimesSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Tempo de preparo inválido (use de 5 a 240 minutos).", code: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return { hours: await service.setPrepTimes(request.user, parsed.data) };
    });

    app.post("/api/store/status", { preHandler: app.requirePanelAuth }, async (request, reply) => {
      const parsed = storeStatusActionSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Ação inválida.", code: "VALIDATION_ERROR", details: parsed.error.flatten() });
      return { hours: await service.setStatus(request.user, parsed.data) };
    });

    // Modo ocupado (g1): OWNER e STAFF ligam e encerram antes da hora; o fim automático é do relógio do servidor.
    app.post("/api/store/busy", { preHandler: app.requirePanelAuth }, async (request, reply) => {
      const parsed = busyRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Escolha até 4 horas.", code: "BUSY_DURATION_INVALID", details: parsed.error.flatten() });
      return { hours: await service.startBusy(request.user, parsed.data) };
    });

    app.delete("/api/store/busy", { preHandler: app.requirePanelAuth }, async (request) => {
      return { hours: await service.endBusy(request.user) };
    });
  };
}
