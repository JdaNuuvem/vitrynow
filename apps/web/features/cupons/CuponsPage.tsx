"use client";

import { useRef, useState } from "react";
import type { Coupon } from "@/core/domain/coupons";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, DataTable, PageHeading, Panel, StateMessage } from "@/shared/design/components";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { CouponRow } from "./components/CouponRow";
import { NewCouponForm } from "./components/NewCouponForm";
import { useCupons } from "./hooks/useCupons";
import "./cupons.css";

export function CuponsPage() {
  const { coupons, error, reload, create, update, setActive, remove } = useCupons();
  const role = useCurrentRole();
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const [query, setQuery] = useState("");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const running = useRef(false);
  const visible = coupons?.filter(({ code }) => code.includes(query.trim().toUpperCase()));

  async function run(action: () => Promise<string | null>, done?: () => void) {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    setFailure(null);
    try {
      const message = await action();
      if (message) setFailure(message);
      else done?.();
    } finally {
      running.current = false;
      setWorking(false);
    }
  }

  return (
    <main className="cupons">
      <PageHeading title="Cupons" description="Acompanhe o uso dos descontos no cardápio."
        actions={<Button variant="primary" icon="coupons" disabled={!role || working} onClick={() => setEditing("new")}>Novo cupom</Button>} />
      {error && <StateMessage title="Cupons indisponíveis" tone="danger" action={<Button onClick={() => void reload()}>Tentar novamente</Button>}>{error}</StateMessage>}
      {failure && !deleting && <StateMessage title="Alteração não concluída" tone="danger">{failure}</StateMessage>}
      {!coupons && !error && <StateMessage title="Carregando cupons" busy />}
      {coupons && <Panel title="Cupons cadastrados">
        <label className="cupons-search">Buscar por código<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {visible?.length ? <DataTable label="Cupons cadastrados" headers={["Código", "Desconto", "Usos", "Validade", "Status", "Ações"]}>
          {visible.map((coupon) => <CouponRow key={coupon.id} coupon={coupon} busy={!role || working}
            onEdit={() => setEditing(coupon)} onSetActive={() => void run(() => setActive(coupon, !coupon.active))}
            onDelete={role === "OWNER" ? () => { setFailure(null); setDeleting(coupon); } : undefined} />)}
        </DataTable> : <StateMessage title={query.trim() ? "Nenhum cupom encontrado" : "Nenhum cupom cadastrado"} />}
      </Panel>}
      {editing && <NewCouponForm initial={editing === "new" ? undefined : editing} restricted={role === "STAFF"}
        onCreate={(input) => editing === "new" ? create(input) : update(editing, input)} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog open title={`Excluir o cupom ${deleting.code}?`} message="O código deixará de ser aceito nos pedidos." tone="danger"
        confirmLabel="Excluir cupom" busy={working} error={failure} onConfirm={() => void run(() => remove(deleting), () => setDeleting(null))}
        onCancel={() => { if (!running.current) setDeleting(null); }} />}
    </main>
  );
}
