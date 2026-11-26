// Reels (ADR-0021): limites e chave de liga/desliga como CONFIGURAÇÃO NOMEADA (nada de número solto nas rotas).
// Valores iniciais decididos pelo Claudio em 19/11 (até a medição do piloto; subir só depois do dimensionamento do Hopper).

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const REEL_LIMITS = {
  /** Arquivo enviado pelo dono. */
  get maxUploadBytes() {
    return intFromEnv("REELS_MAX_UPLOAD_BYTES", 50 * 1024 * 1024);
  },
  /** Duração máxima, pela duração REAL do conteúdo. */
  get maxDurationMs() {
    return intFromEnv("REELS_MAX_DURATION_MS", 30_000);
  },
  /** Vídeos ativos (processando, prontos ou publicados) por loja. */
  get maxActivePerStore() {
    return intFromEnv("REELS_MAX_ACTIVE_PER_STORE", 10);
  },
  /** Espaço de vídeo já processado (MP4 + capa) por loja. */
  get maxBytesPerStore() {
    return intFromEnv("REELS_MAX_BYTES_PER_STORE", 300 * 1024 * 1024);
  },
  /** Reserva de espaço por vídeo ainda processando (o tamanho final só se sabe ao fim). */
  get processingReserveBytes() {
    return intFromEnv("REELS_PROCESSING_RESERVE_BYTES", 12 * 1024 * 1024);
  },
  /** Quadro (em segundos) usado como capa no REEL-1; a escolha de capa é do REEL-2. */
  posterSecond: 1,
  /** Lease do job: passou disso sem terminar, volta à fila. */
  get leaseMs() {
    return intFromEnv("REELS_JOB_LEASE_MS", 5 * 60_000);
  },
  /** Tentativas por vídeo antes de virar FAILED. */
  maxAttempts: 2,
  /** Original órfão (job morto, deploy no meio) é apagado depois disto (Nightingale: 1 h; teto 24 h). */
  get orphanOriginalMs() {
    return intFromEnv("REELS_ORPHAN_ORIGINAL_MS", 60 * 60_000);
  },
};

/** Chave geral: DESLIGADA por padrão. Só `REELS_ENABLED=true` liga (e ainda exige o recurso `reels` no plano da loja). */
export function reelsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.REELS_ENABLED === "true";
}
