-- AlterEnum
ALTER TYPE "CashMovementType" ADD VALUE 'DEVOLUCAO';

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN     "createdByRole" TEXT,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "reasonText" TEXT;

-- AlterTable
ALTER TABLE "CashSession" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closeReasonText" TEXT,
ADD COLUMN     "closedByRole" TEXT,
ADD COLUMN     "summarySnapshot" JSONB;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "cashStaffWithdrawalLimitCents" INTEGER NOT NULL DEFAULT 0;
