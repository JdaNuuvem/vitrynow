// Registro dos recursos que um plano pode liberar (ADR-0003 §2.1, RN-B10-08).
//
// `released` só vira `true` quando o recurso JÁ existe e está testado. Um recurso não entregue
// nunca é liberado a plano algum, mesmo que a chave esteja gravada em `Plan.features`: o
// `planFeatures` o ignora e o teste de contrato (tests/entitlements.test.ts, CA-B10-08) falha
// se alguém o gravar. Quem entrega o recurso troca `released` para `true` na mesma branch.
export const FEATURE_REGISTRY = {
  multi_user: { released: true }, // equipe (já existe: modules/users)
  table_qr: { released: false }, // QR de mesa — libera com API-22
  tab_service: { released: false }, // comanda e pagamento dividido (PRO) — API-42/43
  scheduled_orders: { released: false }, // pedido agendado (PRO) — API-40
  whatsapp_auto: { released: false }, // WhatsApp automático (PRO) — API-41
  advanced_reports: { released: false }, // relatórios avançados (PRO) — API-45
} as const;

export type Feature = keyof typeof FEATURE_REGISTRY;

export const FEATURES = Object.keys(FEATURE_REGISTRY) as Feature[];

export const RELEASED_FEATURES: Feature[] = FEATURES.filter((feature) => FEATURE_REGISTRY[feature].released);

export function isFeature(value: string): value is Feature {
  return Object.prototype.hasOwnProperty.call(FEATURE_REGISTRY, value);
}

export function isReleased(feature: Feature): boolean {
  return FEATURE_REGISTRY[feature].released;
}
