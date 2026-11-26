-- Salão 3D: planta das mesas (posição, rotação, formato, lugares, setor), avisos do QR guardados e elementos do salão.
CREATE TYPE "TableShape" AS ENUM ('SQUARE', 'ROUND', 'RECT');
CREATE TYPE "FloorElementKind" AS ENUM ('WALL', 'COUNTER', 'PLANT', 'DOOR');

ALTER TABLE "Table" ADD COLUMN "posX" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Table" ADD COLUMN "posZ" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Table" ADD COLUMN "rotation" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Table" ADD COLUMN "shape" "TableShape" NOT NULL DEFAULT 'SQUARE';
ALTER TABLE "Table" ADD COLUMN "seats" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "Table" ADD COLUMN "area" TEXT;
ALTER TABLE "Table" ADD COLUMN "callWaiterAt" TIMESTAMP(3);
ALTER TABLE "Table" ADD COLUMN "askBillAt" TIMESTAMP(3);
ALTER TABLE "Table" ADD CONSTRAINT "Table_layout_check" CHECK (
  "posX" BETWEEN -200 AND 200 AND "posZ" BETWEEN -200 AND 200 AND "rotation" BETWEEN 0 AND 359
  AND "seats" BETWEEN 1 AND 20 AND ("area" IS NULL OR char_length("area") BETWEEN 1 AND 40)
);

-- Mesas já existentes: grade inicial (6 por fileira, 2,5 m entre elas) na ordem atual, para o salão nascer arrumado.
WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "storeId" ORDER BY "position", "label") - 1 AS n FROM "Table"
)
UPDATE "Table" t SET "posX" = (o.n % 6) * 2.5, "posZ" = (o.n / 6) * 2.5 FROM ordered o WHERE t."id" = o."id";

CREATE TABLE "FloorElement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "FloorElementKind" NOT NULL,
    "posX" DOUBLE PRECISION NOT NULL,
    "posZ" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "depth" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "area" TEXT,
    CONSTRAINT "FloorElement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FloorElement_check" CHECK (
      "posX" BETWEEN -200 AND 200 AND "posZ" BETWEEN -200 AND 200 AND "rotation" BETWEEN 0 AND 359
      AND "width" > 0 AND "width" <= 100 AND "depth" > 0 AND "depth" <= 100 AND ("area" IS NULL OR char_length("area") BETWEEN 1 AND 40)
    )
);
CREATE INDEX "FloorElement_storeId_idx" ON "FloorElement"("storeId");
ALTER TABLE "FloorElement" ADD CONSTRAINT "FloorElement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O PRO passa a listar o salão 3D.
UPDATE "Plan" SET "features" = array_append("features", 'floor_3d')
WHERE "code" = 'PRO' AND NOT ('floor_3d' = ANY("features"));
