import type { StoreSettings } from "@/core/domain/store";

type OnboardingContext = { store: StoreSettings; hasProducts: boolean };
type OnboardingStep = { label: string; href: string; isDone: (context: OnboardingContext) => boolean };

const SETTINGS_HREF = "/dashboard/conta";
const CATALOG_HREF = "/dashboard/catalogo";

const STEPS: readonly OnboardingStep[] = [
  { label: "Criar o primeiro produto", href: CATALOG_HREF, isDone: ({ hasProducts }) => hasProducts },
  { label: "Endereço da loja", href: SETTINGS_HREF, isDone: ({ store }) => Boolean(store.address) },
  { label: "Horário de funcionamento", href: SETTINGS_HREF, isDone: ({ store }) => Boolean(store.openingHours) },
  { label: "WhatsApp da loja", href: SETTINGS_HREF, isDone: ({ store }) => Boolean(store.whatsapp) },
  { label: "Logo da loja", href: SETTINGS_HREF, isDone: ({ store }) => Boolean(store.logoUrl) },
  { label: "Cor da marca", href: SETTINGS_HREF, isDone: ({ store }) => Boolean(store.primaryColor) },
];

// nextHref: para onde levar o clique (o produto está no catálogo; o resto, nas configurações).
export type OnboardingProgress = { done: number; total: number; nextLabel: string | null; nextHref: string | null };

export function computeOnboarding(store: StoreSettings, hasProducts: boolean): OnboardingProgress {
  const pending = STEPS.filter((step) => !step.isDone({ store, hasProducts }));
  return {
    done: STEPS.length - pending.length,
    total: STEPS.length,
    nextLabel: pending[0]?.label ?? null,
    nextHref: pending[0]?.href ?? null,
  };
}
