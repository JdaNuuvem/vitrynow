"use client";

import { useEffect, useState } from "react";
import type { Category } from "@/core/domain/storefront";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { useStore, useStoreActions, useStoreCatalog } from "@/features/shell/StoreProvider";
import { Button, PageHeading, StateMessage } from "@/shared/design/components";
import { CampaignEditor } from "./CampaignEditor";
import { demoCampaign, httpCampaignGateway } from "./campaignGateways";

const demoCategories: Category[] = [{
  id: "ramen", name: "Ramens", icon: null,
  products: [{ id: "ramen-da-casa", name: "Ramen da casa", description: "Caldo cremoso, noodles frescos e ovo marinado.",
    imageUrl: "/campanhas/ramenku-tigela.webp", priceCents: 3990, additionals: [] }],
}];

export function CampaignDemoPage() {
  const [demo] = useState(() => demoCampaign({
    title: "Ramen da casa", description: "Caldo feito na casa e acompanhamentos à sua escolha.",
    imageLayout: "cutout", imagePosition: "center", imageUrl: "/campanhas/ramenku-tigela.webp",
    action: { label: "Ver ramens", target: { kind: "category", id: "ramen" } },
  }));
  useEffect(() => () => demo.dispose(), [demo]);
  return <CampaignEditor gateway={demo.gateway} categories={demoCategories} accent="#b6432b" demo />;
}

export function StoreCampaignPage() {
  const role = useCurrentRole();
  const store = useStore();
  const { categories, error } = useStoreCatalog();
  const { refreshCatalog } = useStoreActions();
  if (role === "STAFF") return <main className="campaign-page"><PageHeading title="Campanha do cardápio" />
    <StateMessage title="Acesso do dono da loja" tone="warning">Peça ao dono para editar e publicar campanhas.</StateMessage></main>;
  if (role === "OWNER" && error) return <main className="campaign-page"><PageHeading title="Campanha do cardápio" />
    <StateMessage title="Não foi possível carregar o catálogo" tone="danger" action={<Button onClick={refreshCatalog}>Tentar novamente</Button>}>{error}</StateMessage></main>;
  if (!store || role !== "OWNER" || !categories) return <main className="campaign-page"><PageHeading title="Campanha do cardápio" />
    <StateMessage title="Carregando opções do cardápio" busy /></main>;

  const targets: Category[] = categories.flatMap(({ products, ...category }) => {
    const active = products.filter((product) => product.active).map((product) => ({
      ...product, additionals: product.additionals.filter((option) => !!option.id).map((option) => ({ ...option, id: option.id as string })),
    }));
    return active.length ? [{ ...category, products: active }] : [];
  });
  return <CampaignEditor gateway={httpCampaignGateway} categories={targets} accent={store.primaryColor} />;
}
