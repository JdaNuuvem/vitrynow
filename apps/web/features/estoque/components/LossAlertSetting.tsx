"use client";

import { useEffect, useState } from "react";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { Button } from "@/shared/design/components";

const http = new FetchHttpClient();

// Limite do alerta de perda alta (só o dono): perdas acima de X% do faturamento do período mostram o aviso.
export function LossAlertSetting({ current, onSaved }: { current: number; onSaved: () => void }) {
  const [value, setValue] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setValue(String(current)), [current]);
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= 100;

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await http.put<{ lossAlertPercent: number }>("/api/stock/settings", { lossAlertPercent: n });
    setBusy(false);
    if (!r.ok) return setMsg(r.error);
    setMsg("Salvo.");
    onSaved();
  }

  return (
    <div className="estoque__alert-setting">
      <label>
        Avisar quando as perdas passarem de
        <input type="number" min={1} max={100} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Limite do alerta de perda, em %" />
        % do faturamento
      </label>
      <Button busy={busy} disabled={!valid || n === current} onClick={() => void save()}>Salvar</Button>
      {msg ? <span className="estoque__muted" role="status">{msg}</span> : null}
    </div>
  );
}
