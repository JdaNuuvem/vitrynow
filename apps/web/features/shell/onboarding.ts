import type { StoreSettings } from "@/core/domain/store";

type OnboardingStep = { label: string; isDone: (store: StoreSettings) => boolean };

const STEPS: readonly OnboardingStep[] = [
  { label: "Endereço da loja", isDone: (store) => Boolean(store.address) },
  { label: "Horário de funcionamento", isDone: (store) => Boolean(store.openingHours) },
  { label: "WhatsApp da loja", isDone: (store) => Boolean(store.whatsapp) },
  { label: "Logo da loja", isDone: (store) => Boolean(store.logoUrl) },
  { label: "Cor da marca", isDone: (store) => Boolean(store.primaryColor) },
];

export type OnboardingProgress = { done: number; total: number; nextLabel: string | null };

export function computeOnboarding(store: StoreSettings): OnboardingProgress {
  const pending = STEPS.filter((step) => !step.isDone(store));
  return { done: STEPS.length - pending.length, total: STEPS.length, nextLabel: pending[0]?.label ?? null };
}
