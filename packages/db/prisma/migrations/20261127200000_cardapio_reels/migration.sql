-- Modelo do cardápio público: CLASSIC (lista) ou REELS (feed vertical em tela cheia).
CREATE TYPE "MenuLayout" AS ENUM ('CLASSIC', 'REELS');
ALTER TABLE "Store" ADD COLUMN "menuLayout" "MenuLayout" NOT NULL DEFAULT 'CLASSIC';
