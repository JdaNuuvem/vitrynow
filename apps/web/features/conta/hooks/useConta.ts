"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreSettings, StoreSettingsInput } from "@/core/domain/store";
import { usePanelServices } from "@/core/services/PanelServices";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";
import { useStoreActions } from "@/features/shell/StoreProvider";

export type SaveMessage =
  | { kind: "ok"; text: string; settings?: StoreSettings }
  | { kind: "error"; text: string };

const FORBIDDEN_TEXT = "Essa ação é restrita ao dono da loja.";

export function useConta() {
  const router = useRouter();
  const { store: storeGateway, auth } = usePanelServices();
  const { runProtected } = useSecurityConfirm();
  const { publishStoreSettings } = useStoreActions();
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const version = useRef(0);

  const reload = useCallback(async () => {
    const request = ++version.current;
    setLoadError(null);
    const result = await storeGateway.getSettings();
    if (request !== version.current) return;
    if (!result.ok) {
      if (result.status === 401) router.push("/login");
      setLoadError(result.error);
      return;
    }
    setStore(result.data);
  }, [storeGateway, router]);

  useEffect(() => {
    void reload();
    return () => { version.current += 1; };
  }, [reload]);

  const save = useCallback(
    async (input: StoreSettingsInput): Promise<SaveMessage> => {
      const result = await storeGateway.updateSettings(input);
      if (!result.ok) {
        const deniedByRole = result.code === "FORBIDDEN_ROLE" || (result.status === 403 && !result.code);
        return { kind: "error", text: deniedByRole ? FORBIDDEN_TEXT : result.error };
      }
      version.current += 1;
      setStore(result.data);
      publishStoreSettings(result.data);
      return { kind: "ok", text: "Salvo.", settings: result.data };
    },
    [storeGateway, publishStoreSettings],
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

  return { store, save, changePassword, loadError, reload };
}
