import { Suspense } from "react";
import { HistoricoPage } from "@/features/pedidos/historico/HistoricoPage";

// `useSearchParams` (o detalhe vive em `?pedido=<id>`) exige uma fronteira de Suspense no build.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <HistoricoPage />
    </Suspense>
  );
}
