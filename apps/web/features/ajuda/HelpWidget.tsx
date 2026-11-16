"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { usePanelServices } from "@/core/services/PanelServices";
import { Icon } from "@/shared/icons/Icon";
import { NoticesList } from "./components/NoticesList";
import { useNotices } from "./hooks/useNotices";
import "./ajuda.css";

export type HelpTab = "avisos" | "suporte" | "feedback";
type HelpView = HelpTab | "enviado";

type HelpApi = { openHelp: (tab: HelpTab) => void };

const HelpContext = createContext<HelpApi | null>(null);

export function useHelp(): HelpApi {
  const api = useContext(HelpContext);
  if (!api) throw new Error("useHelp precisa estar dentro de <HelpProvider>");
  return api;
}

const TABS: { id: HelpTab; label: string }[] = [
  { id: "avisos", label: "Avisos" },
  { id: "suporte", label: "Suporte" },
  { id: "feedback", label: "Feedback" },
];

const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL;

export function HelpProvider({ children }: { children: ReactNode }) {
  const { feedback } = usePanelServices();
  const { notices, unreadCount, markRead } = useNotices();
  const [opened, setOpened] = useState(false);
  const [view, setView] = useState<HelpView>("avisos");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openHelp = useCallback((tab: HelpTab) => {
    setView(tab);
    setOpened(true);
  }, []);
  const api = useMemo<HelpApi>(() => ({ openHelp }), [openHelp]);

  async function sendFeedback() {
    setSending(true);
    setError(null);
    const result = await feedback.send(message.trim());
    setSending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage("");
    setView("enviado");
  }

  return (
    <HelpContext.Provider value={api}>
      {children}
      <div className="help-widget">
        {opened && (
          <section className="help-widget__panel" aria-label="Ajuda, avisos e feedback">
            <header className="help-widget__header">
              <div className="help-widget__tabs" role="tablist">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={view === tab.id}
                    className={view === tab.id ? "is-selected" : undefined}
                    onClick={() => setView(tab.id)}
                  >
                    {tab.id === "avisos" && <Icon name="bell" size={16} />}
                    {tab.label}
                    {tab.id === "avisos" && unreadCount > 0 && <span className="help-widget__count">{unreadCount}</span>}
                  </button>
                ))}
              </div>
              <button type="button" className="help-widget__minimize" aria-label="Fechar ajuda" onClick={() => setOpened(false)}>
                <Icon name="chevronDown" size={20} />
              </button>
            </header>

            {view === "avisos" && (
              <div className="help-widget__body">
                <NoticesList notices={notices} onRead={markRead} />
              </div>
            )}

            {view === "suporte" && (
              <div className="help-widget__body help-widget__body--center">
                <Icon name="help" size={64} />
                {SUPPORT_URL ? (
                  <a className="help-widget__primary" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
                    Obter suporte
                  </a>
                ) : (
                  <p className="help-widget__muted">O canal de suporte ainda não foi configurado.</p>
                )}
              </div>
            )}

            {view === "feedback" && (
              <div className="help-widget__body">
                <p className="help-widget__question">Como podemos melhorar?</p>
                <textarea
                  value={message}
                  maxLength={2000}
                  placeholder="Descreva o problema ou uma sugestão"
                  onChange={(event) => setMessage(event.target.value)}
                />
                {error && <p className="help-widget__error">{error}</p>}
                <button type="button" className="help-widget__primary" disabled={!message.trim() || sending} onClick={sendFeedback}>
                  {sending ? "Enviando..." : "Enviar"}
                </button>
              </div>
            )}

            {view === "enviado" && (
              <div className="help-widget__body help-widget__body--center">
                <Icon name="check" size={48} />
                <h3>Mensagem enviada</h3>
                <p className="help-widget__muted">Obrigado pelo feedback!</p>
                <button type="button" className="help-widget__primary" onClick={() => setOpened(false)}>
                  Fechar
                </button>
              </div>
            )}
          </section>
        )}

        {!opened && (
          <button type="button" className="help-widget__fab" onClick={() => openHelp("avisos")} aria-label="Ajuda, avisos e feedback">
            <Icon name="help" size={24} />
            {unreadCount > 0 && <span className="help-widget__badge">{unreadCount}</span>}
          </button>
        )}
      </div>
    </HelpContext.Provider>
  );
}
