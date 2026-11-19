-- N6 (RN-IMP-20): janela de retomada de 12 h. Aditiva: um valor novo no enum e uma coluna nula.
ALTER TYPE "PrintJobStatus" ADD VALUE 'STALE';
ALTER TABLE "PrintJob" ADD COLUMN "resumedAt" TIMESTAMP(3);
