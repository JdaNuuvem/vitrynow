import type { StoreSettings, StoreSettingsInput } from "@/core/domain/store";
import { digitsToCents, maskMoneyInput } from "@/shared/format/money";

// Campos como o formulário os edita: tudo texto (valores em R$ ficam mascarados, ex. "20,00").
export type ContaForm = {
  name: string;
  logoUrl: string;
  coverImageUrl: string;
  primaryColor: string;
  customDomain: string;
  address: string;
  whatsapp: string;
  openingHours: string;
  minOrder: string;
  deliveryFee: string;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
};

export function toForm(store: StoreSettings): ContaForm {
  return {
    name: store.name,
    logoUrl: store.logoUrl ?? "",
    coverImageUrl: store.coverImageUrl ?? "",
    primaryColor: store.primaryColor ?? "",
    customDomain: store.customDomain ?? "",
    address: store.address ?? "",
    whatsapp: store.whatsapp ?? "",
    openingHours: store.openingHours ?? "",
    minOrder: store.minOrderCents != null ? maskMoneyInput(String(store.minOrderCents)) : "",
    deliveryFee: store.deliveryFeeCents > 0 ? maskMoneyInput(String(store.deliveryFeeCents)) : "",
    deliveryEnabled: store.deliveryEnabled,
    pickupEnabled: store.pickupEnabled,
  };
}

// Pedido mínimo vazio = não mexe (a API não permite limpar); taxa de entrega vazia = sem taxa (0).
export function toPayload({ minOrder, deliveryFee, ...rest }: ContaForm): StoreSettingsInput {
  return {
    ...rest,
    minOrderCents: minOrder.trim() ? digitsToCents(minOrder) : undefined,
    deliveryFeeCents: deliveryFee.trim() ? digitsToCents(deliveryFee) : 0,
  };
}
