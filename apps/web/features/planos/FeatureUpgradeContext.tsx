"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Modal } from "@/shared/ui/Modal";
import "./planos.css";

type FeatureUpgradeApi = { openUpgrade: () => void };

const FeatureUpgradeContext = createContext<FeatureUpgradeApi | null>(null);

export function useFeatureUpgrade(): FeatureUpgradeApi {
  const api = useContext(FeatureUpgradeContext);
  if (!api) throw new Error("useFeatureUpgrade precisa estar dentro de <FeatureUpgradeProvider>");
  return api;
}

export function FeatureUpgradeProvider({ plansHref, children }: { plansHref: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const api = useMemo<FeatureUpgradeApi>(() => ({ openUpgrade: () => setOpen(true) }), []);

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
          </div>
          <div className="feature-upgrade__actions">
            <Link href={plansHref} className="feature-upgrade__primary" onClick={close}>
              Ver planos
            </Link>
            <button type="button" className="feature-upgrade__secondary" onClick={close}>
              Agora não
            </button>
          </div>
        </div>
      </Modal>
    </FeatureUpgradeContext.Provider>
  );
}
