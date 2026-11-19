-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "busyExtraMinutes" INTEGER,
ADD COLUMN     "busyStartedAt" TIMESTAMP(3),
ADD COLUMN     "busyUntil" TIMESTAMP(3);
