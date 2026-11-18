-- API-15 (B8, ADR-0009): grupos de opções e variações. Fase EXPAND: só tabelas novas e dados; ProductAdditional continua valendo.
-- Todas as tabelas novas têm FK composta (id, storeId) para a mesma loja.

-- CreateEnum
CREATE TYPE "OptionPriceMode" AS ENUM ('SUM', 'BASE');

-- CreateTable
CREATE TABLE "OptionGroup" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "helpText" TEXT,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER,
    "maxPerOption" INTEGER NOT NULL DEFAULT 1,
    "priceMode" "OptionPriceMode" NOT NULL DEFAULT 'SUM',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Option" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOptionGroup" (
    "productId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductOptionGroup_pkey" PRIMARY KEY ("productId","groupId")
);

-- CreateTable
CREATE TABLE "OrderItemOption" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceMode" "OptionPriceMode" NOT NULL DEFAULT 'SUM',

    CONSTRAINT "OrderItemOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OptionGroup_storeId_idx" ON "OptionGroup"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "OptionGroup_id_storeId_key" ON "OptionGroup"("id", "storeId");

-- CreateIndex
CREATE INDEX "Option_groupId_idx" ON "Option"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Option_id_storeId_key" ON "Option"("id", "storeId");

-- CreateIndex
CREATE INDEX "ProductOptionGroup_storeId_idx" ON "ProductOptionGroup"("storeId");

-- CreateIndex
CREATE INDEX "ProductOptionGroup_groupId_idx" ON "ProductOptionGroup"("groupId");

-- CreateIndex
CREATE INDEX "OrderItemOption_orderItemId_idx" ON "OrderItemOption"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_id_storeId_key" ON "Product"("id", "storeId");

-- AddForeignKey
ALTER TABLE "OptionGroup" ADD CONSTRAINT "OptionGroup_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Option" ADD CONSTRAINT "Option_groupId_storeId_fkey" FOREIGN KEY ("groupId", "storeId") REFERENCES "OptionGroup"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_productId_storeId_fkey" FOREIGN KEY ("productId", "storeId") REFERENCES "Product"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_groupId_storeId_fkey" FOREIGN KEY ("groupId", "storeId") REFERENCES "OptionGroup"("id", "storeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemOption" ADD CONSTRAINT "OrderItemOption_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RN-B8-08: cada produto com adicionais ganha o grupo "Adicionais" (mínimo 0, sem máximo, modo SOMA), com as MESMAS
-- opções e preços. O id da opção é o id do adicional: o campo legado `additionalIds` do pedido continua apontando para
-- elas, e o preço de qualquer combinação fica idêntico ao de antes (CA-B8-06). O grupo é marcado LEGACY_ADDITIONALS e
-- fica espelhado pela API enquanto o painel antigo editar ProductAdditional; some na fase CONTRACT.
INSERT INTO "OptionGroup" ("id", "storeId", "name", "minSelect", "maxSelect", "maxPerOption", "priceMode", "source")
SELECT 'og_leg_' || p."id", p."storeId", 'Adicionais', 0, NULL, 1, 'SUM', 'LEGACY_ADDITIONALS'
FROM "Product" p
WHERE EXISTS (SELECT 1 FROM "ProductAdditional" a WHERE a."productId" = p."id");

INSERT INTO "Option" ("id", "storeId", "groupId", "name", "priceCents", "active", "position")
SELECT a."id", p."storeId", 'og_leg_' || p."id", a."name", a."priceCents", true,
       (ROW_NUMBER() OVER (PARTITION BY a."productId" ORDER BY a."id") - 1)::INTEGER
FROM "ProductAdditional" a
JOIN "Product" p ON p."id" = a."productId";

INSERT INTO "ProductOptionGroup" ("productId", "groupId", "storeId", "position")
SELECT p."id", 'og_leg_' || p."id", p."storeId", 0
FROM "Product" p
WHERE EXISTS (SELECT 1 FROM "ProductAdditional" a WHERE a."productId" = p."id");
