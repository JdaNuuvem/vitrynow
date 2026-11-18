import { describe, expect, it } from "vitest";
import type { StoreSettings } from "@/core/domain/store";
import { computeOnboarding } from "./onboarding";

const emptyStore: StoreSettings = {
  id: "s1",
  name: "Loja",
  slug: "loja",
  code: "1",
  logoUrl: null,
  coverImageUrl: null,
  primaryColor: null,
  customDomain: null,
  address: null,
  whatsapp: null,
  openingHours: null,
  minOrderCents: null,
  deliveryEnabled: true,
  pickupEnabled: true,
  acceptingOrders: true,
  deliveryFeeCents: 0,
};

const fullStore: StoreSettings = {
  ...emptyStore,
  address: "Rua A, 1",
  openingHours: "Seg a sex",
  whatsapp: "5521999999999",
  logoUrl: "https://x/logo.png",
  primaryColor: "#16a34a",
};

describe("computeOnboarding", () => {
  it("loja nova: o primeiro passo é criar o primeiro produto e leva ao catálogo", () => {
    const progress = computeOnboarding(emptyStore, false);
    expect(progress.done).toBe(0);
    expect(progress.nextLabel).toBe("Criar o primeiro produto");
    expect(progress.nextHref).toBe("/dashboard/catalogo");
  });

  it("com produto, o próximo passo vai para as configurações", () => {
    const progress = computeOnboarding(emptyStore, true);
    expect(progress.done).toBe(1);
    expect(progress.nextLabel).toBe("Endereço da loja");
    expect(progress.nextHref).toBe("/dashboard/conta");
  });

  it("tudo pronto: sem próximo passo", () => {
    const progress = computeOnboarding(fullStore, true);
    expect(progress.done).toBe(progress.total);
    expect(progress.nextLabel).toBeNull();
    expect(progress.nextHref).toBeNull();
  });

  it("loja configurada mas sem produto ainda não está pronta", () => {
    const progress = computeOnboarding(fullStore, false);
    expect(progress.done).toBe(progress.total - 1);
    expect(progress.nextLabel).toBe("Criar o primeiro produto");
  });
});
