import { useId, useRef, useState } from "react";
import type { GroupChange, OptionGroup, OptionGroupInput } from "@/core/domain/optionGroups";
import type { HttpResult } from "@/core/http/HttpClient";
import { digitsToCents, maskMoneyInput } from "@/shared/format/money";
import { Modal } from "@/shared/ui/Modal";
import { MoneyInput } from "@/shared/ui/MoneyInput";

export function OptionGroupForm({ initial, save, onSaved, onClose }: {
  initial?: OptionGroup;
  save: (input: OptionGroupInput, id?: string) => Promise<HttpResult<GroupChange>>;
  onSaved: (result: GroupChange) => void;
  onClose: () => void;
}) {
  const title = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [help, setHelp] = useState(initial?.helpText ?? "");
  const [mode, setMode] = useState<OptionGroupInput["priceMode"]>(initial?.priceMode ?? "SUM");
  const [min, setMin] = useState(String(initial?.minSelect ?? 0));
  const [max, setMax] = useState(initial?.maxSelect === null ? "" : String(initial?.maxSelect ?? 1));
  const [per, setPer] = useState(String(initial?.maxPerOption ?? 1));
  const [options, setOptions] = useState(() => (initial?.options ?? []).map((option, key) => ({
    id: option.id as string | undefined,
    key,
    name: option.name,
    price: maskMoneyInput(String(option.priceCents)),
    active: option.active,
  })));
  const nextKey = useRef(options.length);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (inFlight.current) return;
    const payload: OptionGroupInput = {
      name: name.trim(), helpText: help.trim() || null,
      minSelect: mode === "BASE" ? 1 : Number(min), maxSelect: mode === "BASE" ? 1 : max === "" ? null : Number(max),
      maxPerOption: mode === "BASE" ? 1 : Number(per), priceMode: mode,
      options: options.map((option) => ({ ...(option.id ? { id: option.id } : {}), name: option.name.trim(),
        priceCents: digitsToCents(option.price), active: option.active })),
    };
    if (!payload.name || payload.options.some((option) => !option.name)) return setError("Informe o nome do grupo e de todas as opções.");
    if (payload.options.some((option) => option.priceCents > 100_000_000)) return setError("Cada opção aceita até R$ 1.000.000,00.");
    if (payload.maxSelect !== null && payload.maxSelect < payload.minSelect) return setError("O máximo precisa ser igual ou maior que o mínimo.");
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await save(payload, initial?.id);
      if (!result.ok) setError(result.error);
      else onSaved(result.data);
    } catch {
      setError("Não foi possível salvar o grupo. Confira a conexão e tente novamente.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={() => { if (!inFlight.current) onClose(); }} labelledBy={title} width={670} sheetOnMobile>
      <form className="catalogo-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h2 id={title}>{initial ? "Editar grupo de opções" : "Novo grupo de opções"}</h2>
        <fieldset className="catalogo-form__fields" disabled={saving}>
          <label className="catalogo-field">Nome do grupo<input required maxLength={150} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="catalogo-field">Orientação para o cliente (opcional)<textarea rows={2} maxLength={300}
            value={help} onChange={(event) => setHelp(event.target.value)} /></label>
          <label className="catalogo-field">Como o preço é calculado
            <select value={mode} onChange={(event) => setMode(event.target.value as OptionGroupInput["priceMode"])}>
              <option value="SUM">Somar ao preço do produto</option>
              <option value="BASE">Definir o preço do produto</option>
            </select>
          </label>
          {mode === "BASE" ? <p className="catalogo-group__rule">O cliente escolhe uma variação obrigatória. O valor dessa variação vira o preço-base.</p> : (
            <div className="catalogo-group__limits">
              <label className="catalogo-field">Mínimo de escolhas<input type="number" required min={0} max={100} value={min} onChange={(e) => setMin(e.target.value)} /></label>
              <label className="catalogo-field">Máximo de escolhas<input type="number" min={1} max={100} placeholder="Sem limite" value={max} onChange={(e) => setMax(e.target.value)} /></label>
              <label className="catalogo-field">Máximo por opção<input type="number" required min={1} max={99} value={per} onChange={(e) => setPer(e.target.value)} /></label>
            </div>
          )}
          <fieldset className="catalogo-group__options">
            <legend>Opções do grupo</legend>
            {options.map((option, index) => (
              <div key={option.key} className="catalogo-group__option">
                <label className="catalogo-field">Nome da opção {index + 1}
                  <input required maxLength={150} value={option.name} onChange={(event) => setOptions((current) => current.map((item) =>
                    item.key === option.key ? { ...item, name: event.target.value } : item))} />
                </label>
                <label className="catalogo-field">Preço da opção {index + 1}
                  <MoneyInput name={`option-price-${option.key}`} value={option.price} onChange={(price) => setOptions((current) => current.map((item) =>
                    item.key === option.key ? { ...item, price } : item))} />
                </label>
                <label className="catalogo-check"><input type="checkbox" checked={option.active} onChange={(event) => setOptions((current) => current.map((item) =>
                  item.key === option.key ? { ...item, active: event.target.checked } : item))} /> Disponível</label>
                <button type="button" className="catalogo__btn catalogo__btn--danger" aria-label={`Remover opção ${index + 1}`}
                  onClick={() => setOptions((current) => current.filter((item) => item.key !== option.key))}>Remover</button>
              </div>
            ))}
            <button type="button" className="catalogo__btn" disabled={options.length >= 30} onClick={() => {
              const key = nextKey.current++;
              setOptions((current) => [...current, { key, id: undefined, name: "", price: "", active: true }]);
            }}>Adicionar opção</button>
          </fieldset>
        </fieldset>
        {error && <p className="catalogo__error" role="alert">{error}</p>}
        <div className="catalogo-form__actions">
          <button className="catalogo__btn" type="button" disabled={saving} onClick={onClose}>Cancelar</button>
          <button className="catalogo__btn catalogo__btn--primary" type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar grupo"}</button>
        </div>
      </form>
    </Modal>
  );
}
