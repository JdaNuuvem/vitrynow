"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/shared/ui/Modal";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";

const http = new FetchHttpClient();
import "./planos.css";

// `feature` (opcional): o recurso que o servidor bloqueou (402 FEATURE_LOCKED). Com ele, o aviso oferece "Quero ser avisado"
// (RN-B10-05: mede a demanda; não promete data nem preço).
type FeatureUpgradeApi = { openUpgrade: (feature?: string) => void };

const FeatureUpgradeContext = createContext<FeatureUpgradeApi | null>(null);

export function useFeatureUpgrade(): FeatureUpgradeApi {
  const api = useContext(FeatureUpgradeContext);
  if (!api) throw new Error("useFeatureUpgrade precisa estar dentro de <FeatureUpgradeProvider>");
  return api;
}

export function FeatureUpgradeProvider({ plansHref, children }: { plansHref: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [feature, setFeature] = useState<string | null>(null);
  const [interest, setInterest] = useState<"idle" | "sending" | "done" | "error">("idle");
  const close = useCallback(() => setOpen(false), []);
  const api = useMemo<FeatureUpgradeApi>(() => ({
    openUpgrade: (locked?: string) => {
      setFeature(locked ?? null);
      setInterest("idle");
      setOpen(true);
    },
  }), []);

  async function registerInterest() {
    if (!feature || interest === "sending") return;
    setInterest("sending");
    const result = await http.post("/api/store/feature-interest", { feature });
    // 409 = o plano já inclui: nada a avisar, mas também não é erro para quem clicou.
    setInterest(result.ok || (!result.ok && result.status === 409) ? "done" : "error");
  }

  return (
    <FeatureUpgradeContext.Provider value={api}>
      {children}
      <Modal open={open} onClose={close} labelledBy="feature-upgrade-title" width={480}>
        <div className="feature-upgrade">
          <div className="feature-upgrade__icon" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <div className="feature-upgrade__text">
            <h3 id="feature-upgrade-title">Libere esta função agora</h3>
            <p>
              <span>Ela faz parte de um plano mais completo.</span>
              <span>Assine em poucos cliques e continue exatamente de onde parou.</span>
            </p>
            {interest === "done" && <p role="status">Anotado! Vamos avisar a loja quando houver novidade sobre esta função.</p>}
            {interest === "error" && <p role="alert">Não foi possível registrar agora. Tente de novo.</p>}
          </div>
          <div className="feature-upgrade__actions">
            <Link href={plansHref} className="feature-upgrade__primary" onClick={close}>
              Ver planos
            </Link>
            {feature && interest !== "done" && <button type="button" className="feature-upgrade__secondary" disabled={interest === "sending"} onClick={() => void registerInterest()}>
              Quero ser avisado
            </button>}
            <button type="button" className="feature-upgrade__secondary" onClick={close}>
              Agora não
            </button>
          </div>
        </div>
      </Modal>
    </FeatureUpgradeContext.Provider>
  );
}
