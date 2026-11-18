"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MFA_REQUIRED_CODE, type MfaChallenge, type MfaPurpose } from "@/core/domain/mfa";
import type { HttpResult, RequestOptions } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { SecurityConfirmModal } from "./components/SecurityConfirmModal";
import "./seguranca.css";

const RESEND_COOLDOWN_SECONDS = 60;
const CANCELED_MESSAGE = "Confirmação cancelada.";

type ProtectedAction<T> = (options?: RequestOptions) => Promise<HttpResult<T>>;

type SecurityApi = {
  // Executa a ação; se a API exigir confirmação de segurança (403 MFA_REQUIRED), pede o código
  // por e-mail e repete a ação com o comprovante. Telas só chamam isto, sem conhecer o fluxo.
  runProtected: <T>(purpose: MfaPurpose, action: ProtectedAction<T>) => Promise<HttpResult<T>>;
};

const SecurityContext = createContext<SecurityApi | null>(null);

export function useSecurityConfirm(): SecurityApi {
  const api = useContext(SecurityContext);
  if (!api) throw new Error("useSecurityConfirm precisa estar dentro de <SecurityConfirmProvider>");
  return api;
}

export function SecurityConfirmProvider({ children }: { children: ReactNode }) {
  const { mfa } = usePanelServices();
  const [purpose, setPurpose] = useState<MfaPurpose | null>(null);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const resolver = useRef<((challengeId: string | null) => void) | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  const sendCode = useCallback(
    async (target: MfaPurpose) => {
      setBusy(true);
      setError(null);
      const result = await mfa.requestChallenge(target);
      setBusy(false);
      if (!result.ok) return setError(result.error);
      setChallenge(result.data);
      setResendIn(RESEND_COOLDOWN_SECONDS);
    },
    [mfa],
  );

  const requestConfirmation = useCallback(
    (target: MfaPurpose) =>
      new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setChallenge(null);
        setPurpose(target);
        void sendCode(target);
      }),
    [sendCode],
  );

  const finish = useCallback((challengeId: string | null) => {
    resolver.current?.(challengeId);
    resolver.current = null;
    setPurpose(null);
    setChallenge(null);
    setError(null);
  }, []);

  async function submitCode(code: string) {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    const result = await mfa.verify(challenge.challengeId, code);
    setBusy(false);
    if (result.ok) return finish(challenge.challengeId);
    setError(result.error);
  }

  const runProtected = useCallback(
    async <T,>(target: MfaPurpose, action: ProtectedAction<T>): Promise<HttpResult<T>> => {
      const first = await action();
      if (first.ok || first.code !== MFA_REQUIRED_CODE) return first;

      const challengeId = await requestConfirmation(target);
      if (!challengeId) return { ok: false, status: first.status, error: CANCELED_MESSAGE, code: first.code };
      return action({ headers: { "x-mfa-challenge": challengeId } });
    },
    [requestConfirmation],
  );

  const api = useMemo(() => ({ runProtected }), [runProtected]);

  return (
    <SecurityContext.Provider value={api}>
      {children}
      <SecurityConfirmModal
        purpose={purpose}
        maskedEmail={challenge?.maskedEmail ?? null}
        busy={busy}
        error={error}
        resendIn={resendIn}
        onSubmit={submitCode}
        onResend={() => purpose && sendCode(purpose)}
        onCancel={() => finish(null)}
      />
    </SecurityContext.Provider>
  );
}
