"use client";

import { useState } from "react";
import type { Product, ProductInput } from "@/core/domain/catalog";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { Modal } from "@/shared/ui/Modal";
import { Switch } from "@/shared/ui/Switch";
import { draftFromProduct, toProductInput, type ProductDraft } from "../productForm";
import { AdditionalsEditor } from "./AdditionalsEditor";

type ProductFormProps = {
  categoryId: string;
  initial?: Product;
  onSave: (input: ProductInput, productId?: string) => Promise<string | null>;
  onClose: () => void;
};

export function ProductForm({ categoryId, initial, onSave, onClose }: ProductFormProps) {
  const [draft, setDraft] = useState<ProductDraft>(() => draftFromProduct(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const patch = (changes: Partial<ProductDraft>) => setDraft((prev) => ({ ...prev, ...changes }));

  async function submit() {
    if (!draft.name.trim()) return setError("Informe o nome do produto.");
    setSaving(true);
    setError(null);
    const failure = await onSave(toProductInput(categoryId, draft), initial?.id);
    setSaving(false);
    if (failure) return setError(failure);
    onClose();
  }

  return (
    <Modal open onClose={onClose} labelledBy="product-form-title" width={520} sheetOnMobile>
      <div className="catalogo-form">
        <h2 id="product-form-title">{initial ? "Editar produto" : "Novo produto"}</h2>

        <div className="catalogo-form__row">
          <input placeholder="Nome" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
          <div className="catalogo-form__price">
            <MoneyInput name="product-price" value={draft.price} onChange={(price) => patch({ price })} />
          </div>
        </div>
        <input
          placeholder="Descrição (opcional)"
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
        <input
          placeholder="URL da foto do produto (opcional)"
          value={draft.imageUrl}
          onChange={(event) => patch({ imageUrl: event.target.value })}
        />

        <div className="catalogo-form__toggles">
          <label>
            <Switch label="Ativo" checked={draft.active} onChange={(active) => patch({ active })} /> Ativo
          </label>
          <label>
            <Switch label="Destaque" checked={draft.featured} onChange={(featured) => patch({ featured })} /> Destaque
          </label>
        </div>

        <AdditionalsEditor additionals={draft.additionals} onChange={(additionals) => patch({ additionals })} />

        {error && <p className="catalogo__error">{error}</p>}

        <div className="catalogo-form__actions">
          <button type="button" className="catalogo__btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="catalogo__btn catalogo__btn--primary" disabled={saving} onClick={submit}>
            Salvar
          </button>
        </div>
      </div>
    </Modal>
  );
}
