-- ESTOQUE: o adicional LEGADO escolhido guarda de qual adicional veio (sem FK: o adicional pode ser apagado depois).
-- O id é o mesmo da opção-espelho LEGACY_ADDITIONALS, então a ficha técnica dessa opção dá baixa no estoque.
ALTER TABLE "OrderItemAdditional" ADD COLUMN "additionalId" TEXT;
