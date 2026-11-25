import type { Subscription } from "@/core/domain/subscription";
import { activeStoreTimezone, formatInStoreTimezone } from "@/shared/format/storeTime";

// Nome de cada recurso de plano (códigos de apps/api/src/lib/features.ts). Código sem nome aqui NÃO aparece cru na tela:
// vira "Outros recursos do plano" (ver featureLabel).
export const FEATURE_LABELS: Record<string, string> = {
  multi_user: "Usuários da equipe com acesso limitado",
  table_qr: "Pedidos pelo QR Code da mesa",
  tab_service: "Conta da mesa com pagamento dividido",
  scheduled_orders: "Pedidos agendados",
  advanced_reports: "Relatórios avançados",
  whatsapp_auto: "Mensagens automáticas no WhatsApp",
};
export const UNKNOWN_FEATURE_LABEL = "Outros recursos do plano";

export const BASELINE_FEATURES = ["Cardápio online e pedidos", "Painel de pedidos em tempo real", "Controle de caixa e relatórios"];

export type SubscriptionTone = "info" | "ok" | "warning" | "danger";

export type SubscriptionDescription = {
  badge: string;
  tone: SubscriptionTone;
  headline: string;
  detail: string;
};

function formatDate(iso: string): string {
  return formatInStoreTimezone(iso, activeStoreTimezone(), { day: "2-digit", month: "2-digit", year: "numeric" });
}

function days(count: number): string {
  return `${count} ${count === 1 ? "dia" : "dias"}`;
}

export function describeSubscription(subscription: Subscription): SubscriptionDescription {
  const plan = subscription.planName ?? "Plano";
  switch (subscription.state) {
    case "trial":
      return {
        badge: "Teste grátis",
        tone: subscription.daysLeft <= 3 ? "warning" : "info",
        headline: `Restam ${days(subscription.daysLeft)} de teste grátis`,
        detail: `O teste termina em ${formatDate(subscription.trialEndsAt)}. Assine um plano para continuar usando todos os recursos.`,
      };
    case "active":
      return {
        badge: "Ativo",
        tone: "ok",
        headline: `Plano ${plan}`,
        detail: `Próxima renovação em ${formatDate(subscription.currentPeriodEnd!)} (${days(subscription.daysLeft)}).`,
      };
    case "canceled":
      return {
        badge: "Cancelado",
        tone: "warning",
        headline: `Plano ${plan} cancelado`,
        detail: `Você mantém o acesso até ${formatDate(subscription.currentPeriodEnd!)}.`,
      };
    case "past_due":
      return {
        badge: "Vencido",
        tone: "danger",
        headline: `Plano ${plan} vencido`,
        detail: "O período pago terminou. Renove para liberar os recursos do plano novamente.",
      };
    case "expired":
      return {
        badge: "Encerrado",
        tone: "danger",
        headline: "Seu teste grátis terminou",
        detail: "Assine um plano para voltar a usar os recursos que dependem dele.",
      };
  }
}

export function featureLabel(feature: string): string {
  return Object.prototype.hasOwnProperty.call(FEATURE_LABELS, feature) ? FEATURE_LABELS[feature] : UNKNOWN_FEATURE_LABEL;
}
