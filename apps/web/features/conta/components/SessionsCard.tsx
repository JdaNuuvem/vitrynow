"use client";

import { useState } from "react";
import { usePanelServices } from "@/core/services/PanelServices";
import { Button, Panel, StateMessage } from "@/shared/design/components";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";

// "Sair de todos os dispositivos": encerra a sessão em todo celular e computador onde esta conta entrou (aparelho perdido,
// funcionário que saiu usando o login). Este aparelho continua logado com uma sessão nova.
export function SessionsCard() {
  const { auth } = usePanelServices();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function logoutAll() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await auth.logoutAll();
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setConfirming(false);
    setDone(true);
  }

  return <Panel title="Acessos">
    <p>Entrou na sua conta num aparelho que não é seu, ou perdeu o celular? Encerre o acesso em todos os aparelhos de uma vez.</p>
    {done && <StateMessage tone="success" title="Pronto: os outros aparelhos foram desconectados.">Este aparelho continua conectado.</StateMessage>}
    <Button variant="danger" onClick={() => { setError(null); setDone(false); setConfirming(true); }}>Sair de todos os dispositivos</Button>
    <ConfirmDialog open={confirming} tone="danger" busy={busy} error={error}
      title="Sair de todos os dispositivos?"
      message="Todos os celulares e computadores conectados com esta conta precisarão entrar de novo. Este aparelho continua conectado."
      confirmLabel="Sair de todos" onConfirm={() => void logoutAll()} onCancel={() => { if (!busy) setConfirming(false); }} />
  </Panel>;
}
