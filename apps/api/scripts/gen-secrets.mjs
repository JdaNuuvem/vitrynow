// Gera valores novos para os segredos obrigatórios. SÓ IMPRIME — não escreve em nenhum arquivo.
// Copie as linhas para o seu apps/api/.env local. Nunca cole os valores em chat, tabela ou commit.
import { randomBytes } from "node:crypto";

const secret = () => randomBytes(48).toString("base64url"); // 384 bits

console.log(`JWT_SECRET="${secret()}"`);
console.log(`MFA_HMAC_KEY="${secret()}"`);
