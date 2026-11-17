import type { FastifyReply } from "fastify";

// Limite de taxa em memória (janela deslizante de 1 min), um balde por CHAVE. Serve a rotas raras e sensíveis (troca de modo de impressão,
// alertas de dispositivo) onde o limite precisa valer por IP ANTES da autenticação, por usuário ou por loja. Por instância e zera no reinício:
// ok para o piloto (1 instância); com 2+ réplicas vira por instância e deve ir para o banco (mesmo registro do limite de login).
const WINDOW_MS = 60_000;
const SWEEP_EVERY = 5_000; // varre chaves ociosas quando o mapa passa deste tamanho (o Map não cresce sem fim)

const hits = new Map<string, number[]>();

/** Registra uma tentativa na chave e diz se ESTOUROU o teto (`true` = recusar; a tentativa recusada não conta). */
export function limited(key: string, max: number, now: number = Date.now()): boolean {
  if (hits.size > SWEEP_EVERY) {
    for (const [k, list] of hits) if (list.length === 0 || now - list[list.length - 1] >= WINDOW_MS) hits.delete(k);
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  const over = recent.length >= max;
  if (!over) recent.push(now);
  hits.set(key, recent);
  return over;
}

/** Resposta 429 única do sistema (mesmo corpo em toda rota; ver CA-CP-17). */
export function tooMany(reply: FastifyReply) {
  reply.header("Retry-After", "60");
  return reply.code(429).send({ error: "Muitas tentativas. Aguarde um minuto e tente de novo.", code: "RATE_LIMITED" });
}

/** Só para teste: zera os baldes. */
export function resetLimits() {
  hits.clear();
}
