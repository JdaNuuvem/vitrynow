-- API-71: kanban com histórico grande. O "encerrados de hoje" parte dos registros de encerramento do dia.
CREATE INDEX "OrderStatusHistory_status_createdAt_idx" ON "OrderStatusHistory"("status", "createdAt");
