import { Suspense } from "react";
import { PedidosPage } from "@/features/pedidos/PedidosPage";

// `useSearchParams` (o detalhe vive em `?pedido=<id>`) exige uma fronteira de Suspense no build.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <PedidosPage />
    </Suspense>
  );
}
