-- API-40 (PRO): pedido agendado. O pedido nasce retido (`held`) e o job `schedule.release` o solta no kanban/impressão
-- no horário (scheduledFor - tempo de preparo). Retido só existe com horário.
ALTER TABLE "Order" ADD COLUMN "scheduledFor" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "held" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD CONSTRAINT "Order_held_needs_schedule" CHECK (NOT "held" OR "scheduledFor" IS NOT NULL);
CREATE INDEX "Order_held_scheduledFor_idx" ON "Order"("held", "scheduledFor");

-- Agendamento entregue: o PRO passa a listar `scheduled_orders`.
UPDATE "Plan" SET "features" = array_append("features", 'scheduled_orders')
WHERE "code" = 'PRO' AND NOT ('scheduled_orders' = ANY("features"));
