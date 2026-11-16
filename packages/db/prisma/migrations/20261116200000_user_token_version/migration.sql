-- ADR-0008: versão da sessão do usuário (revogação imediata de JWT).
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
