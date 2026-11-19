import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Product } from "@/core/domain/catalog";
import type { OptionGroup, ProductGroups } from "@/core/domain/optionGroups";
import { usePanelServices } from "@/core/services/PanelServices";
import { Button, StateMessage } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { Modal } from "@/shared/ui/Modal";
import { CatalogOrderButtons, moveId } from "../components/CatalogOrderButtons";
import { groupRule } from "./groupRules";

export function ProductGroupsDialog({ product, onClose, onChange }: {
  product: Product;
  onClose: () => void;
  onChange: () => Promise<void>;
}) {
  const { catalog } = usePanelServices();
  const title = useId();
  const [library, setLibrary] = useState<OptionGroup[] | null>(null);
  const [saved, setSaved] = useState<ProductGroups | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [next, setNext] = useState("");
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    const current = ++version.current;
    setLoadingError(null);
    try {
      const [available, attached] = await Promise.all([catalog.listOptionGroups(), catalog.listProductGroups(product.id)]);
      if (current !== version.current) return;
      if (!available.ok || !attached.ok) {
        setLoadingError(!available.ok ? available.error : !attached.ok ? attached.error : null);
        return;
      }
      setLibrary(available.data.groups.filter((group) => group.source !== "LEGACY_ADDITIONALS"));
      setSaved(attached.data);
      setIds(attached.data.groups.filter((group) => group.source !== "LEGACY_ADDITIONALS").map((group) => group.id));
    } catch {
      if (current === version.current) setLoadingError("Não foi possível carregar as opções do produto. Confira a conexão.");
    }
  }, [catalog, product.id]);

  useEffect(() => {
    void load();
    return () => { version.current += 1; };
  }, [load]);

  const known = new Map([...(library ?? []), ...(saved?.groups ?? [])].map((group) => [group.id, group]));
  const linked = ids.map((id) => known.get(id)).filter((group): group is OptionGroup => !!group);
  const candidates = library?.filter((group) => !ids.includes(group.id)) ?? [];
  const changed = JSON.stringify(ids) !== JSON.stringify(saved?.groups.filter((group) => group.source !== "LEGACY_ADDITIONALS").map((group) => group.id));

  function patch(nextIds: string[]) {
    setIds(nextIds);
    setNotice(null);
    setError(null);
  }

  async function save() {
    if (inFlight.current || !changed || !saved) return;
    if (linked.filter((group) => group.priceMode === "BASE").length > 1) {
      return setError("Escolha apenas um grupo de preço-base para este produto.");
    }
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const result = await catalog.setProductGroups(product.id, ids);
      if (!result.ok) return setError(result.error);
      setSaved(result.data);
      setIds(result.data.groups.filter((group) => group.source !== "LEGACY_ADDITIONALS").map((group) => group.id));
      setNotice("Grupos salvos.");
      await onChange();
    } catch {
      setError("Não foi possível salvar os vínculos. Confira a conexão e tente novamente.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => { if (!inFlight.current) onClose(); }} labelledBy={title} width={620} sheetOnMobile>
      <div className="catalogo-form">
        <h2 id={title}>Opções de {product.name}</h2>
        {loadingError && <StateMessage title="Opções indisponíveis" tone="danger" action={<Button onClick={() => void load()}>Tentar novamente</Button>}>{loadingError}</StateMessage>}
        {!saved && !loadingError && <StateMessage title="Carregando opções" busy />}
        {saved && <>
          {saved.fromPriceCents !== null && <p>Preço publicado a partir de <strong>{formatCents(saved.fromPriceCents)}</strong>.</p>}
          {saved.unavailableBecause.length > 0 && <StateMessage title="Produto indisponível" tone="warning">
            Complete as opções obrigatórias em {saved.unavailableBecause.map(({ name }) => name).join(", ")}.
          </StateMessage>}
          <ul className="catalogo-group__linked">
            {linked.map((group, index) => (
              <li key={group.id}>
                <div><strong>{group.name}</strong><p>{groupRule(group)}</p></div>
                <CatalogOrderButtons label={group.name} first={index === 0} last={index === linked.length - 1} busy={busy} onMove={(direction) => {
                  const moved = moveId(ids, group.id, direction);
                  if (moved) patch(moved);
                }} />
                <Button variant="quiet" aria-label={`Remover vínculo de ${group.name}`} disabled={busy} onClick={() => patch(ids.filter((id) => id !== group.id))}>Remover</Button>
              </li>
            ))}
            {!linked.length && <li>Nenhum grupo vinculado a este produto.</li>}
          </ul>
          {candidates.length > 0 && ids.length < 10 && <div className="catalogo-group__attach">
            <label className="catalogo-field">Vincular grupo
              <select value={next} disabled={busy} onChange={(event) => setNext(event.target.value)}>
                <option value="">Selecione um grupo</option>
                {candidates.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            <Button disabled={busy || !next} onClick={() => { patch([...ids, next]); setNext(""); }}>Adicionar</Button>
          </div>}
        </>}
        {notice && <p role="status">{notice}</p>}
        {error && <p className="catalogo__error" role="alert">{error}</p>}
        <div className="catalogo-form__actions">
          <Button disabled={busy} onClick={onClose}>Fechar</Button>
          {saved && <Button variant="primary" busy={busy} disabled={!changed} onClick={() => void save()}>Salvar vínculos</Button>}
        </div>
      </div>
    </Modal>
  );
}
