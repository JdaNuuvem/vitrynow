"use client";

import { useState } from "react";
import { createHttpStorefrontServices } from "@/core/services/createHttpStorefrontServices";
import { StorefrontServicesProvider } from "@/core/services/StorefrontServices";
import { LojaPage } from "./LojaPage";

// Ponto de entrada client da loja: cria os serviços HTTP uma única vez e os injeta.
export function LojaRoot({ slug }: { slug: string }) {
  const [services] = useState(() => createHttpStorefrontServices());
  return (
    <StorefrontServicesProvider services={services}>
      <LojaPage slug={slug} />
    </StorefrontServicesProvider>
  );
}
