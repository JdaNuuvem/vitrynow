-- LGPD (API-52d, ADR-0014 §3): lista de "nao contatar" por HASH do telefone (nunca o numero), por loja.
CREATE TABLE "DoNotContact" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DoNotContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DoNotContact_storeId_phoneHash_key" ON "DoNotContact"("storeId", "phoneHash");
ALTER TABLE "DoNotContact" ADD CONSTRAINT "DoNotContact_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
