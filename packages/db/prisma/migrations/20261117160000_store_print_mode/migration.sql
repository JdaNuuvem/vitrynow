-- ADR-0004 §8.12: modo de impressão por loja (expand: coluna com padrão LEGACY, nada muda para as lojas existentes).
-- CreateEnum
CREATE TYPE "PrintMode" AS ENUM ('LEGACY', 'QUEUE');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "printMode" "PrintMode" NOT NULL DEFAULT 'LEGACY';
