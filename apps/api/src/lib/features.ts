// Registro dos recursos que um plano pode liberar (ADR-0003 §2.1, RN-B10-08).
//
// `released` só vira `true` quando o recurso JÁ existe e está testado. Um recurso não entregue
// nunca é liberado a plano algum, mesmo que a chave esteja gravada em `Plan.features`: o
// `planFeatures` o ignora e o teste de contrato (tests/entitlements.test.ts, CA-B10-08) falha
// se alguém o gravar. Quem entrega o recurso troca `released` para `true` na mesma branch.
//
// `tier` diz em que plano o recurso nasce: "BASICO" (já faz parte do plano de entrada, mesmo que
// ainda não entregue) ou "PRO". Só recurso do PRO aceita "Quero ser avisado" (RN-B10-05).
export const FEATURE_REGISTRY = {
  multi_user: { released: true, tier: "PRO" }, // equipe (já existe: modules/users)
  table_qr: { released: true, tier: "BASICO" }, // QR de mesa — entregue com API-22/24 (routes/tables.ts)
  tab_service: { released: true, tier: "PRO" }, // comanda (conta da mesa) com pagamento dividido — API-42/43 (routes/tables.ts /receive)
  scheduled_orders: { released: true, tier: "PRO" }, // pedido agendado — API-40 (storefront scheduledFor + job schedule.release)
  whatsapp_auto: { released: false, tier: "PRO" }, // WhatsApp automático — API-41
  advanced_reports: { released: true, tier: "PRO" }, // relatórios avançados — API-45 (GET /api/reports/advanced)
} as const satisfies Record<string, { released: boolean; tier: "BASICO" | "PRO" }>;

export type Feature = keyof typeof FEATURE_REGISTRY;

export const FEATURES = Object.keys(FEATURE_REGISTRY) as Feature[];

export const RELEASED_FEATURES: Feature[] = FEATURES.filter((feature) => FEATURE_REGISTRY[feature].released);

export function isFeature(value: string): value is Feature {
  return Object.prototype.hasOwnProperty.call(FEATURE_REGISTRY, value);
}

export function isReleased(feature: Feature): boolean {
  return FEATURE_REGISTRY[feature].released;
}

export function isProFeature(feature: Feature): boolean {
  return FEATURE_REGISTRY[feature].tier === "PRO";
}
