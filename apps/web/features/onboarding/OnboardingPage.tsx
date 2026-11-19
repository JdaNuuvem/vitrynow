"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { useStore } from "@/features/shell/StoreProvider";
import "./onboarding.css";

const http = new FetchHttpClient();
type Status = "DONE" | "PENDING" | "SKIPPED";
type Onboarding = {
  emailVerified: boolean;
  steps: { id: OnboardingStepId; status: Status; automatic: boolean }[];
  progress: { done: number; total: number };
  readyToShare: boolean;
};

type OnboardingStepId = keyof typeof labels;
const labels = {
  STORE_DATA: { title: "Dados da loja", href: "/dashboard/conta", link: "Editar dados" },
  HOURS: { title: "Horário de atendimento", href: "/dashboard/conta/horarios", link: "Configurar horários" },
  FIRST_PRODUCT: { title: "Primeiro produto", href: "/dashboard/catalogo", link: "Abrir catálogo" },
  DELIVERY: { title: "Entrega e retirada", href: "/dashboard/conta/entrega", link: "Configurar entrega" },
  PAYMENTS: { title: "Pagamentos", href: "/dashboard/pagamentos", link: "Configurar pagamentos" },
  PRINTER: { title: "Impressora", href: "/dashboard/impressoras", link: "Configurar impressora" },
  TEST_ORDER: { title: "Pedido de teste", link: "Abrir cardápio" },
  SHARE: { title: "Divulgar cardápio", link: "Abrir cardápio" },
} satisfies Record<string, { title: string; href?: string; link: string }>;

const statusLabel: Record<Status, string> = { DONE: "Concluído", PENDING: "Pendente", SKIPPED: "Pulado" };

export function OnboardingPage() {
  const store = useStore();
  const { auth } = usePanelServices();
  const [data, setData] = useState<Onboarding | null>(null);
  const [owner, setOwner] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const publicHref = store ? `/loja/${encodeURIComponent(store.slug)}` : undefined;

  const load = useCallback(async () => {
    const result = await http.get<Onboarding>("/api/onboarding");
    if (result.ok) setData(result.data);
    else setError(result.error);
  }, []);

  useEffect(() => {
    void load();
    void auth.me().then((result) => { if (result.ok) setOwner(result.data.user.role === "OWNER"); });
  }, [auth, load]);

  async function resend() {
    setPending(true);
    setMessage(null);
    setError(null);
    const result = await http.post<{ alreadyVerified?: boolean }>("/api/auth/verify-email/resend");
    if (!result.ok) setError(result.error);
    else if (result.data.alreadyVerified) await load();
    else setMessage("Solicitação registrada. Confira sua caixa de entrada.");
    setPending(false);
  }

  async function update(step: OnboardingStepId, status: Status) {
    setPending(true);
    setError(null);
    const result = await http.post(`/api/onboarding/steps/${step}`, { status });
    if (result.ok) await load();
    else setError(result.error);
    setPending(false);
  }

  return (
    <main className="setup">
      <h1>Primeiros passos</h1>
      {error && <p className="setup__error" role="alert">{error}</p>}
      {!data && (error ? <button className="setup__button" type="button" onClick={() => { setError(null); void load(); }}>Tentar novamente</button> : <p role="status">Carregando configuração…</p>)}
      {data && (
        <>
          {!data.emailVerified && <section className="setup__mail"><div><h2>Confirme seu e-mail</h2><p>Use o link enviado para liberar a assinatura da sua loja.</p></div><button className="setup__button" type="button" disabled={pending} onClick={() => void resend()}>Reenviar e-mail</button></section>}
          {message && <p role="status">{message}</p>}
          <section className="setup__steps">
            <header><h2>Configuração da loja</h2><p>{data.progress.done} de {data.progress.total} etapas concluídas</p></header>
            <progress aria-label="Etapas concluídas" value={data.progress.done} max={data.progress.total} />
            {data.readyToShare && <p className="setup__ready">Seu cardápio está pronto para divulgar.</p>}
            <ul>
              {data.steps.map((step) => {
                const label = labels[step.id];
                const href = "href" in label ? label.href : publicHref;
                return <li key={step.id}>
                  <div><strong>{label.title}</strong><span className={`setup__status setup__status--${step.status.toLowerCase()}`}>{statusLabel[step.status]}</span></div>
                  <div className="setup__actions">
                    {href && <Link className="setup__button" href={href}>{label.link}</Link>}
                    {owner && step.status === "SKIPPED" && <button className="setup__button" type="button" disabled={pending} onClick={() => void update(step.id, "PENDING")}>Retomar</button>}
                    {owner && step.status === "PENDING" && !step.automatic && <button className="setup__button" type="button" disabled={pending} onClick={() => void update(step.id, "DONE")}>Marcar concluído</button>}
                    {owner && step.status === "PENDING" && <button className="setup__button" type="button" disabled={pending} onClick={() => void update(step.id, "SKIPPED")}>Pular</button>}
                  </div>
                </li>;
              })}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
