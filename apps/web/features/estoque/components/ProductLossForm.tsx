"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Category } from "@/core/domain/catalog";
import { LOSS_NOTE_MAX, WASTE_REASONS } from "@/core/domain/stock";
import type { StockGateway } from "@/core/gateways/StockGateway";
import type { HttpResult } from "@/core/http/HttpClient";
import { usePanelServices } from "@/core/services/PanelServices";
import { Button, StateMessage } from "@/shared/design/components";
import { Modal } from "@/shared/ui/Modal";

export const PRODUCT_LOSS_MAX = 100;

// Perda de PRATO PRONTO ("caiu um ramen"): escolhe o prato e a quantidade; a API dá baixa de cada insumo da ficha técnica
// como desperdício, com o motivo. Prato sem ficha é recusado pela API (PRODUCT_NO_RECIPE): aí a perda é lançada por insumo.
export function ProductLossForm({ gateway, run, onClose }: {
  gateway: StockGateway;
  run: (action: () => Promise<HttpResult<unknown>>) => Promise<string | null>;
  onClose: () => void;
}) {
  const title = useId();
  const { catalog } = usePanelServices();
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState<keyof typeof WASTE_REASONS>("CAIU");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    void catalog.listCategories().then((result) => {
      if (!alive) return;
      if (result.ok) setCategories(result.data.categories);
      else setLoadError(result.error);
    });
    return () => { alive = false; };
  }, [catalog]);

  async function submit() {
    if (inFlight.current) return;
    const quantity = Number(qty);
    if (!productId) return setError("Escolha o prato.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > PRODUCT_LOSS_MAX) return setError(`Informe uma quantidade de 1 a ${PRODUCT_LOSS_MAX}.`);
    if (reason === "OUTRO" && !note.trim()) return setError("Escreva a observação do motivo Outro.");
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const failure = await run(() => gateway.productLoss(productId, { quantity, reason, ...(note.trim() ? { note: note.trim() } : {}) }));
      if (failure) setError(failure);
      else onClose();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <Modal open labelledBy={title} width={480} sheetOnMobile fitContent onClose={() => { if (!inFlight.current) onClose(); }}>
    <form className="estoque__form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id={title}>Perda de prato pronto</h2>
      <p className="estoque__hint">Cada insumo da ficha técnica do prato sai do estoque como desperdício.</p>
      {loadError && <StateMessage tone="danger" title="Cardápio indisponível">{loadError}</StateMessage>}
      {!categories && !loadError && <StateMessage title="Carregando cardápio" busy />}
      {categories && <>
        <label>Prato
          <select value={productId} disabled={busy} required onChange={(event) => setProductId(event.target.value)}>
            <option value="">Escolha…</option>
            {categories.map((c) => <optgroup key={c.id} label={c.name}>
              {c.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>)}
          </select>
        </label>
        <label>Motivo
          <select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value as keyof typeof WASTE_REASONS)}>
            {Object.entries(WASTE_REASONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>Observação{reason === "OUTRO" ? "" : " (opcional)"}
          <input value={note} maxLength={LOSS_NOTE_MAX} required={reason === "OUTRO"} disabled={busy} onChange={(event) => setNote(event.target.value)} />
        </label>
        <label>Quantidade de pratos
          <input required type="number" inputMode="numeric" min={1} max={PRODUCT_LOSS_MAX} value={qty} disabled={busy} onChange={(event) => setQty(event.target.value)} />
        </label>
      </>}
      {error && <StateMessage tone="danger" title="Perda não registrada">{error}</StateMessage>}
      <div className="estoque__actions">
        <Button onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" variant="primary" busy={busy} disabled={!categories}>Registrar</Button>
      </div>
    </form>
  </Modal>;
}
