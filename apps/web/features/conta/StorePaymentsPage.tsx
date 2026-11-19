"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StorePaymentSettings } from "@/core/gateways/StoreGateway";
import { usePanelServices } from "@/core/services/PanelServices";
import { useSecurityConfirm } from "@/features/seguranca/SecurityConfirmProvider";
import { API_URL } from "@/lib/api";
import { Button, PageHeading, Panel, StateMessage, StatusBadge } from "@/shared/design/components";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import "./conta.css";

const accountLabel: Record<StorePaymentSettings["mercadopago"]["status"], string> = {
  CONNECTED: "Conta conectada", NOT_CONNECTED: "Nenhuma conta conectada",
  DISCONNECTED: "Conta desconectada", NEEDS_RECONNECT: "Reconexão necessária",
};

function providerUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const apiOrigin = new URL(API_URL, window.location.origin).origin;
    const provider = url.origin === "https://auth.mercadopago.com.br" && url.pathname === "/authorization";
    const localCallback = [apiOrigin, window.location.origin].includes(url.origin) && url.pathname === "/api/store/payments/mercadopago/callback";
    return !url.username && !url.password && (provider || localCallback) ? url.href : null;
  } catch {
    return null;
  }
}

export function StorePaymentsPage() {
  const { store } = usePanelServices();
  const { runProtected } = useSecurityConfirm();
  const [settings, setSettings] = useState<StorePaymentSettings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "danger" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const version = useRef(0);
  const running = useRef(false);
  const reload = useCallback(async () => {
    const attempt = ++version.current;
    setError("");
    const result = await store.payments();
    if (attempt !== version.current) return;
    setSettings(result.ok ? result.data : null);
    setError(result.ok ? "" : result.status === 403 ? "Apenas o dono da loja pode gerenciar a conta de pagamentos." : result.error);
  }, [store]);
  useEffect(() => {
    void reload();
    if (new URLSearchParams(window.location.search).get("mp") === "erro") {
      setNotice({ tone: "danger", text: "Não foi possível concluir a conexão com o Mercado Pago. Confira as pendências e tente novamente." });
    }
    return () => { version.current += 1; };
  }, [reload]);

  async function connect() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await runProtected("connect_payment", (options) => store.connectPayment(options));
      if (!result.ok) return setNotice({ tone: "danger", text: result.error });
      const url = providerUrl(result.data.authorizationUrl);
      if (!url) return setNotice({ tone: "danger", text: "O provedor devolveu um endereço de autorização inválido." });
      window.location.assign(url);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function disconnect() {
    if (running.current) return;
    running.current = true;
    setConfirming(false);
    setBusy(true);
    setNotice(null);
    try {
      const result = await runProtected("disconnect_payment", (options) => store.disconnectPayment(options));
      setNotice(result.ok ? { tone: "success", text: "Conta desconectada." } : { tone: "danger", text: result.error });
      await reload();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const status = settings?.mercadopago.status;
  const pending = settings ? settings.pending.pixPending > 0 || settings.pending.refundPending > 0 : false;

  return (
    <main className="conta">
      <PageHeading title="Recebimento por Pix" description="Gerencie a conta que recebe os pagamentos dos pedidos do cardápio."
        actions={<Link href="/dashboard/conta" className="ds-button ds-button--quiet">Voltar à minha loja</Link>} />
      {error && <StateMessage title="Não foi possível carregar a conta" tone="danger" action={<Button onClick={reload}>Consultar novamente</Button>}>{error}</StateMessage>}
      {!settings && !error && <StateMessage title="Consultando a conta da loja" busy />}
      {notice && <StateMessage title={notice.text} tone={notice.tone} />}
      {settings && status && <Panel title="Mercado Pago" className="conta-payments" actions={<StatusBadge tone={status === "CONNECTED" ? "success" : status === "NEEDS_RECONNECT" ? "warning" : "neutral"}>{accountLabel[status]}</StatusBadge>}>
        {settings.mercadopago.sellerMasked && <p className="conta__meta">Conta {settings.mercadopago.sellerMasked}</p>}
        <dl className="conta-payments__summary">
          <div><dt>Pix no checkout</dt><dd>{settings.pixAvailable ? "Disponível" : "Indisponível"}</dd></div>
          <div><dt>Pagamentos pendentes</dt><dd>{settings.pending.pixPending}</dd></div>
          <div><dt>Estornos pendentes</dt><dd>{settings.pending.refundPending}</dd></div>
        </dl>
        <div className="conta-payments__actions">
          {status !== "CONNECTED" && <Button variant="primary" busy={busy} onClick={connect}>
            {status === "NEEDS_RECONNECT" ? "Reconectar Mercado Pago" : "Conectar Mercado Pago"}
          </Button>}
          {(status === "CONNECTED" || status === "NEEDS_RECONNECT") &&
            <Button variant="danger" disabled={busy || pending} onClick={() => setConfirming(true)}>Desconectar conta</Button>}
        </div>
        {pending && <p className="conta__meta">Conclua os pagamentos e estornos pendentes para desconectar a conta.</p>}
      </Panel>}
      <ConfirmDialog open={confirming} title="Desconectar Mercado Pago?" message="A loja deixará de receber novos pedidos por PIX nesta conta."
        confirmLabel="Desconectar" tone="danger" onCancel={() => setConfirming(false)} onConfirm={disconnect} />
    </main>
  );
}
