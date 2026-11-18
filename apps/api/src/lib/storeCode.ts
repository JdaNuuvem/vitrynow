import { randomInt } from "node:crypto";
import { prisma } from "@meucardapio/db";

// RN-ONB-01: o código da loja (campo `code`) deixou de ser pedido no cadastro; o servidor gera um curto, único e legível
// (sem 0/O/1/I). A unicidade final é do índice do banco; a checagem aqui só evita a corrida comum.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomStoreCode(length = 6): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}
export async function generateStoreCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomStoreCode(attempt < 5 ? 6 : 8);
    if (!(await prisma.store.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new Error("não foi possível gerar um código de loja único");
}
