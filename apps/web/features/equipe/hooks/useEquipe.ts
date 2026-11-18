"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { TeamUser } from "@/core/domain/users";
import { usePanelServices } from "@/core/services/PanelServices";
import { useFeatureUpgrade } from "@/features/planos/FeatureUpgradeContext";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";

const FEATURE_LOCKED_CODE = "FEATURE_LOCKED";

export function useEquipe() {
  const router = useRouter();
  const { users: usersGateway } = usePanelServices();
  const { runProtected } = useSecurityConfirm();
  const { openUpgrade } = useFeatureUpgrade();
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await usersGateway.list();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      if (result.status === 403) setForbidden(true);
      return;
    }
    setUsers(result.data.users);
  }, [usersGateway, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Devolve true se convidou, pra o formulário saber se pode limpar os campos.
  const invite = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setError(null);
      const result = await usersGateway.inviteStaff(email, password);
      if (!result.ok) {
        // Plano sem "multi_user": em vez de erro seco, oferece a assinatura.
        if (result.code === FEATURE_LOCKED_CODE) openUpgrade();
        else setError(result.error);
        return false;
      }
      reload();
      return true;
    },
    [usersGateway, reload, openUpgrade],
  );

  // Remover usuário é ação sensível: com MFA ligado pede o código antes de repetir a chamada.
  const remove = useCallback(
    async (id: string) => {
      setError(null);
      const result = await runProtected("delete_user", (options) => usersGateway.remove(id, options));
      if (!result.ok) return setError(result.error);
      reload();
    },
    [usersGateway, reload, runProtected],
  );

  return { users, forbidden, error, invite, remove };
}
