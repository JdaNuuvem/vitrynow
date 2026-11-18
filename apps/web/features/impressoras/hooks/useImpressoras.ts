"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { DeviceToken } from "@/core/domain/deviceTokens";
import { usePanelServices } from "@/core/services/PanelServices";

export type CreateOutcome = { status: "created"; token: string } | { status: "error"; message: string } | { status: "forbidden" };

export function useImpressoras() {
  const router = useRouter();
  const { deviceTokens } = usePanelServices();
  const [tokens, setTokens] = useState<DeviceToken[] | null>(null);
  // Dois motivos independentes: a lista recusada (STAFF) e uma ação recusada (criar/revogar).
  // Separados para um reload tardio não apagar o aviso de uma ação.
  const [listForbidden, setListForbidden] = useState(false);
  const [actionForbidden, setActionForbidden] = useState(false);

  const reload = useCallback(async () => {
    const result = await deviceTokens.list();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      // 403: a lista é restrita ao dono (NG-06). Mostra o aviso em vez de "nenhuma chave".
      if (result.status === 403) setListForbidden(true);
      return;
    }
    setListForbidden(false);
    setTokens(result.data.tokens);
  }, [deviceTokens, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (label: string): Promise<CreateOutcome> => {
      setActionForbidden(false);
      const result = await deviceTokens.create(label);
      if (!result.ok) {
        if (result.status === 403) {
          setActionForbidden(true);
          return { status: "forbidden" };
        }
        return { status: "error", message: result.error };
      }
      reload();
      const value = result.data.token.token;
      // A chave só aparece nesta resposta; sem ela não há o que copiar.
      if (!value) return { status: "error", message: "A chave foi criada, mas o servidor não a devolveu. Revogue e gere outra." };
      return { status: "created", token: value };
    },
    [deviceTokens, reload],
  );

  const revoke = useCallback(
    async (id: string) => {
      const result = await deviceTokens.revoke(id);
      if (!result.ok && result.status === 403) return setActionForbidden(true);
      setActionForbidden(false);
      reload();
    },
    [deviceTokens, reload],
  );

  return { tokens, forbidden: listForbidden || actionForbidden, create, revoke };
}
