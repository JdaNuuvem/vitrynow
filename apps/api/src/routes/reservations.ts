import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { createReservationSchema, reservationsQuerySchema, updateReservationSchema } from "@meucardapio/shared-types";
import { logAudit } from "../lib/audit";
import { requireFeature } from "../lib/subscription";
import { publishToStore } from "../realtime/hub";
import { CodedError, useDomainErrors } from "../shared/errors";

// SALÃO 3D (opcional): reservas de mesa. Só no painel (equipe), dentro do recurso `floor_3d`.
// A mesa aparece como "Reservada" no mapa perto do horário (regra em tableStatusOf, shared-types). "Chegou" (SEATED) põe as pessoas na mesa.
const view = (r: { id: string; tableId: string | null; customerName: string; customerPhone: string | null; partySize: number; startsAt: Date; durationMin: number; status: string; notes: string | null; table?: { label: string } | null }) => ({
  id: r.id,
  tableId: r.tableId,
  tableLabel: r.table?.label ?? null,
  customerName: r.customerName,
  customerPhone: r.customerPhone,
  partySize: r.partySize,
  startsAt: r.startsAt.toISOString(),
  durationMin: r.durationMin,
  status: r.status,
  notes: r.notes,
});

async function assertTable(storeId: string, tableId: string | null | undefined) {
  if (!tableId) return;
  const table = await prisma.table.findFirst({ where: { id: tableId, storeId }, select: { id: true } });
  if (!table) throw new CodedError(404, "TABLE_NOT_FOUND", "Mesa não encontrada.");
}

/** Outra reserva ATIVA na mesma mesa com horário sobreposto? */
async function assertNoOverlap(storeId: string, tableId: string | null | undefined, startsAt: Date, durationMin: number, ignoreId?: string) {
  if (!tableId) return;
  const end = new Date(startsAt.getTime() + durationMin * 60_000);
  const clash = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Reservation"
    WHERE "storeId" = ${storeId} AND "tableId" = ${tableId} AND "status" = 'BOOKED' AND "id" <> ${ignoreId ?? ""}
      AND "startsAt" < ${end} AND "startsAt" + ("durationMin" * interval '1 minute') > ${startsAt}
    LIMIT 1`;
  if (clash.length) throw new CodedError(409, "RESERVATION_OVERLAP", "Esta mesa já tem reserva nesse horário.");
}

const reservationRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);
  const panel = { preHandler: [app.requirePanelAuth, requireFeature("floor_3d")] };

  app.get("/api/reservations", panel, async (request, reply) => {
    const parsed = reservationsQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Período inválido.", code: "VALIDATION_ERROR" });
    const from = parsed.data.from ? new Date(parsed.data.from) : new Date(Date.now() - 6 * 3600_000);
    const to = parsed.data.to ? new Date(parsed.data.to) : new Date(from.getTime() + 7 * 24 * 3600_000);
    const rows = await prisma.reservation.findMany({
      where: { storeId: request.user.storeId, startsAt: { gte: from, lte: to } },
      orderBy: { startsAt: "asc" },
      take: 500,
      include: { table: { select: { label: true } } },
    });
    return { reservations: rows.map(view) };
  });

  app.post("/api/reservations", panel, async (request, reply) => {
    const { storeId, userId } = request.user;
    const parsed = createReservationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const input = parsed.data;
    const startsAt = new Date(input.startsAt);
    const durationMin = input.durationMin ?? 90;
    await assertTable(storeId, input.tableId);
    await assertNoOverlap(storeId, input.tableId, startsAt, durationMin);
    const created = await prisma.reservation.create({
      data: { storeId, tableId: input.tableId ?? null, customerName: input.customerName, customerPhone: input.customerPhone ?? null, partySize: input.partySize, startsAt, durationMin, notes: input.notes ?? null, createdByUserId: userId },
      include: { table: { select: { label: true } } },
    });
    // auditoria sem nome/telefone do cliente (dado pessoal fica só na reserva)
    logAudit({ storeId, userId, action: "reservation.create", targetType: "Reservation", targetId: created.id, metadata: { tableId: created.tableId, partySize: created.partySize, startsAt: created.startsAt.toISOString() } });
    if (created.tableId) publishToStore(storeId, { type: "table.updated", tableId: created.tableId });
    return reply.code(201).send({ reservation: view(created) });
  });

  app.patch("/api/reservations/:id", panel, async (request, reply) => {
    const { storeId, userId } = request.user;
    const { id } = request.params as { id: string };
    const parsed = updateReservationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const input = parsed.data;
    const current = await prisma.reservation.findFirst({ where: { id, storeId } });
    if (!current) throw new CodedError(404, "RESERVATION_NOT_FOUND", "Reserva não encontrada.");
    const tableId = input.tableId !== undefined ? input.tableId : current.tableId;
    const startsAt = input.startsAt ? new Date(input.startsAt) : current.startsAt;
    const durationMin = input.durationMin ?? current.durationMin;
    await assertTable(storeId, tableId);
    if ((input.status ?? current.status) === "BOOKED") await assertNoOverlap(storeId, tableId, startsAt, durationMin, id);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.reservation.update({
        where: { id },
        data: {
          tableId: tableId ?? null,
          startsAt,
          durationMin,
          ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
          ...(input.customerPhone !== undefined ? { customerPhone: input.customerPhone } : {}),
          ...(input.partySize !== undefined ? { partySize: input.partySize } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
        include: { table: { select: { label: true } } },
      });
      // "Chegou": as pessoas da reserva sentam na mesa (se ninguém informou antes)
      if (input.status === "SEATED" && row.tableId) await tx.table.updateMany({ where: { id: row.tableId, storeId, guests: null }, data: { guests: Math.min(50, row.partySize) } });
      return row;
    });
    logAudit({ storeId, userId, action: "reservation.update", targetType: "Reservation", targetId: id, metadata: { status: updated.status, tableId: updated.tableId } });
    for (const t of new Set([current.tableId, updated.tableId])) if (t) publishToStore(storeId, { type: "table.updated", tableId: t });
    return { reservation: view(updated) };
  });
};

export default reservationRoutes;
