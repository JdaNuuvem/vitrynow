"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { StoreSettings } from "@/core/domain/store";
import { usePanelServices } from "@/core/services/PanelServices";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";
import { toPayload, type ContaForm } from "../contaForm";

export type SaveMessage = { kind: "ok" | "error"; text: string };

const FORBIDDEN_TEXT = "Essa ação é restrita ao dono da loja.";

export function useConta() {
  const router = useRouter();
  const { store: storeGateway, auth } = usePanelServices();
  const { runProtected } = useSecurityConfirm();
  const [store, setStore] = useState<StoreSettings | null>(null);

  const reload = useCallback(async () => {
    const result = await storeGateway.getSettings();
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      return;
    }
    setStore(result.data);
  }, [storeGateway, router]);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = useCallback(
    async (form: ContaForm): Promise<SaveMessage> => {
      const result = await storeGateway.updateSettings(toPayload(form));
      if (!result.ok) return { kind: "error", text: result.status === 403 ? FORBIDDEN_TEXT : result.error };
      reload();
      return { kind: "ok", text: "Salvo." };
    },
    [storeGateway, reload],
  );

  // Devolve a mensagem de erro, ou null se trocou a senha. Com MFA ligado, pede o código
  // por e-mail antes de repetir a chamada.
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<string | null> => {
      const result = await runProtected("change_password", (options) =>
        auth.changePassword(currentPassword, newPassword, options),
      );
      return result.ok ? null : result.error;
    },
    [auth, runProtected],
  );

  return { store, save, changePassword };
}
