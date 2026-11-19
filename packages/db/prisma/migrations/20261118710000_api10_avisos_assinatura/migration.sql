-- API-10: avisos de assinatura (7/3/1 dias e entrada em Consulta/Suspensão), uma linha por (assinatura, tipo, vencimento).
-- CreateEnum
CREATE TYPE "SubscriptionNoticeKind" AS ENUM ('D7', 'D3', 'D1', 'READ_ONLY', 'SUSPENDED');
-- CreateTable
CREATE TABLE "SubscriptionNotice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "kind" "SubscriptionNoticeKind" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionNotice_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "SubscriptionNotice_sentAt_idx" ON "SubscriptionNotice"("sentAt");
-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionNotice_subscriptionId_kind_dueAt_key" ON "SubscriptionNotice"("subscriptionId", "kind", "dueAt");
-- AddForeignKey
ALTER TABLE "SubscriptionNotice" ADD CONSTRAINT "SubscriptionNotice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
