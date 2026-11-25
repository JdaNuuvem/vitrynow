"use client";

import { useEffect, useState, type FormEvent } from "react";
import { FetchHttpClient } from "@/core/http/FetchHttpClient";
import { Button, Panel, StateMessage } from "@/shared/design/components";

// Até quanto a EQUIPE pode dar de desconto sem pedir ao dono: vale no pedido lançado no painel (%) e no fechamento da
// mesa (sobre a conta com a taxa). Acima disso a API recusa com "Peça ao dono". O dono não tem limite.
const http = new FetchHttpClient();

export function DiscountLimitCard({ owner }: { owner: boolean }) {
  const [current, setCurrent] = useState<number | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void http.get<{ limitPercent: number }>("/api/store/manual-discount-limit").then((result) => {
      if (!alive || !result.ok) return;
      setCurrent(result.data.limitPercent);
      setValue(String(result.data.limitPercent));
    });
    return () => { alive = false; };
  }, []);

  const percent = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(percent) && percent >= 0 && percent <= 100;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !valid || percent === current) return;
    setBusy(true);
    setMessage(null);
    const result = await http.put<{ limitPercent: number }>("/api/store/manual-discount-limit", { limitPercent: percent });
    setBusy(false);
    if (!result.ok) return setMessage({ ok: false, text: result.error });
    setCurrent(result.data.limitPercent);
    setMessage({ ok: true, text: "Limite atualizado." });
  }

  if (current === null) return null;
  return <Panel title="Limite de desconto da equipe">
    <p>Vale para pedidos lançados no painel e para o fechamento da mesa. Acima disso, só o dono aprova.</p>
    {owner ? <form className="equipe__limit" onSubmit={submit}>
      <label>Desconto máximo (%)<input type="number" min={0} max={100} step={1} value={value} disabled={busy} onChange={(event) => { setValue(event.target.value); setMessage(null); }} /></label>
      <Button variant="primary" type="submit" busy={busy} disabled={!valid || percent === current}>Salvar limite</Button>
    </form> : <p><strong>Até {current}%</strong> sem pedir ao dono.</p>}
    {message && <StateMessage tone={message.ok ? "success" : "danger"} title={message.text} />}
  </Panel>;
}
