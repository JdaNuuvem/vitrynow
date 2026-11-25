"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceToken } from "@/core/domain/deviceTokens";
import { MFA_REQUIRED_CODE } from "@/core/domain/mfa";
import { usePanelServices } from "@/core/services/PanelServices";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";

export type RevokeOutcome = { status: "done" } | { status: "forbidden" } | { status: "error"; message: string };

export type CreateOutcome = { status: "created"; token: string } | { status: "error"; message: string } | { status: "forbidden" };

export function useImpressoras() {
  const router = useRouter();
  const { deviceTokens } = usePanelServices();
  const { runProtected } = useSecurityConfirm();
  const [tokens, setTokens] = useState<DeviceToken[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const revision = useRef(0);
  // Dois motivos independentes: a lista recusada (STAFF) e uma ação recusada (criar/revogar).
  // Separados para um reload tardio não apagar o aviso de uma ação.
  const [listForbidden, setListForbidden] = useState(false);
  const [actionForbidden, setActionForbidden] = useState(false);

  const reload = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    setLoadError(null);
    const result = await deviceTokens.list();
    if (request !== revision.current) return;
    setLoading(false);
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      if (result.status === 401 || result.status === 403) setTokens(null);
      if (result.status === 403) setListForbidden(true);
      else setLoadError(result.error);
      return;
    }
    setListForbidden(false);
    setTokens(result.data.tokens);
  }, [deviceTokens, router]);

  useEffect(() => {
    void reload();
    return () => { revision.current++; };
  }, [reload]);

  const create = useCallback(
    async (label: string): Promise<CreateOutcome> => {
      setActionForbidden(false);
      const result = await runProtected("device_token_create", (options) => deviceTokens.create(label, options));
      if (!result.ok) {
        // 403 com MFA_REQUIRED é a pessoa que CANCELOU a confirmação (não é STAFF sem permissão).
        if (result.status === 403 && result.code !== MFA_REQUIRED_CODE) {
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
    [deviceTokens, reload, runProtected],
  );

  const revoke = useCallback(
    async (id: string): Promise<RevokeOutcome> => {
      setActionForbidden(false);
      const result = await runProtected("device_token_revoke", (options) => deviceTokens.revoke(id, options));
      if (!result.ok) {
        // 403 com MFA_REQUIRED é a pessoa que CANCELOU a confirmação (não é STAFF sem permissão).
        if (result.status === 403 && result.code !== MFA_REQUIRED_CODE) {
          setActionForbidden(true);
          return { status: "forbidden" };
        }
        // Antes só o 403 era tratado e qualquer outra falha sumia em silêncio: a chave seguia na lista sem explicação.
        return { status: "error", message: result.error || "Não foi possível revogar a chave agora. Tente de novo." };
      }
      reload();
      return { status: "done" };
    },
    [deviceTokens, reload, runProtected],
  );

  return { tokens, loading, loadError, reload, forbidden: listForbidden || actionForbidden, create, revoke };
}
