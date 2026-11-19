// DADOS (RN-DAD-04): toda resposta de relatório diz o que está incompleto; a tela mostra o aviso e nunca zero para o desconhecido.
// Motivos são os mesmos de `incompleteWhen` do dicionário (lib/metricDictionary.ts).
import type { ReportPeriod } from "./reportPeriod";

export const COMPLETENESS_REASONS = ["PERIODO_EM_ANDAMENTO", "TETO_ATINGIDO", "SEM_HISTORICO", "ANONIMIZADOS", "REGRA_MUDOU"] as const;
export type CompletenessReason = (typeof COMPLETENESS_REASONS)[number];
export type Completeness = { partial: boolean; reasons: CompletenessReason[] };

export function completenessFor(period: ReportPeriod, extra: CompletenessReason[] = []): Completeness {
  const reasons: CompletenessReason[] = [...(period.partial ? (["PERIODO_EM_ANDAMENTO"] as const) : []), ...extra];
  return { partial: reasons.length > 0, reasons: [...new Set(reasons)] };
}
