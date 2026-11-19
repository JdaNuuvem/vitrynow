import { useId, useRef, useState } from "react";
import type { Category } from "@/core/domain/catalog";
import { Modal } from "@/shared/ui/Modal";

type Props = {
  category: Category;
  onClose: () => void;
} & ({ kind: "edit"; onSave: (input: { name: string; icon: string }) => Promise<string | null> }
  | { kind: "move"; destinations: { id: string; name: string }[]; onSave: (target: string) => Promise<string | null> });

export function CategoryManagementDialog(props: Props) {
  const { category, kind, onClose } = props;
  const title = useId();
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon ?? "");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const moved = category.products.length;

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      const failure = props.kind === "edit" ? await props.onSave({ name: name.trim(), icon: icon.trim() }) : await props.onSave(target);
      if (failure) setError(failure);
      else onClose();
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={() => { if (!inFlight.current) onClose(); }} labelledBy={title} width={470} sheetOnMobile fitContent>
      <form className="catalogo-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <h2 id={title}>{kind === "edit" ? "Editar categoria" : `Mover produtos de ${category.name}`}</h2>
        {props.kind === "edit" ? (<>
          <label className="catalogo-field">Nome da categoria<input required maxLength={50} value={name} disabled={saving} onChange={(event) => setName(event.target.value)} /></label>
          <label className="catalogo-field">Emoji (opcional)<input maxLength={8} value={icon} disabled={saving} onChange={(event) => setIcon(event.target.value)} /></label>
        </>) : (<>
          <p>{moved === 1 ? "Um produto será movido para a categoria de destino." : `${moved} produtos serão movidos para a categoria de destino.`}</p>
          <label className="catalogo-field">Categoria de destino
            <select required value={target} disabled={saving} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Selecione uma categoria</option>
              {props.destinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.name}</option>)}
            </select>
          </label>
        </>)}
        {error && <p className="catalogo__error" role="alert">{error}</p>}
        <div className="catalogo-form__actions">
          <button className="catalogo__btn" type="button" disabled={saving} onClick={onClose}>Cancelar</button>
          <button className="catalogo__btn catalogo__btn--primary" type="submit" disabled={saving || (kind === "edit" ? !name.trim() : !target)}>
            {saving ? "Aguarde…" : kind === "edit" ? "Salvar categoria" : "Mover produtos"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
