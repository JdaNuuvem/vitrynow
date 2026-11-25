"use client";

import { useId, useRef, useState } from "react";
import type { Category, Product, ProductInput } from "@/core/domain/catalog";
import { IMAGE_FILE_ACCEPT, MAX_IMAGE_BYTES, uploadImage } from "@/core/gateways/http/uploadImage";
import { validateStoreImageUrl } from "@/shared/format/imageUrl";
import { MoneyInput } from "@/shared/ui/MoneyInput";
import { Modal } from "@/shared/ui/Modal";
import { Switch } from "@/shared/ui/Switch";
import { draftFromProduct, toProductInput, type ProductDraft } from "../productForm";
import { AdditionalsEditor } from "./AdditionalsEditor";

type ProductFormProps = {
  categoryId: string;
  initial?: Product;
  categories?: Pick<Category, "id" | "name">[];
  onSave: (input: ProductInput, productId?: string) => Promise<string | null>;
  onClose: () => void;
};

export function ProductForm({ categoryId, initial, categories, onSave, onClose }: ProductFormProps) {
  const [draft, setDraft] = useState<ProductDraft>(() => draftFromProduct(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [destination, setDestination] = useState(categoryId);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageErrorId = useId();
  const patch = (changes: Partial<ProductDraft>) => setDraft((prev) => ({ ...prev, ...changes }));

  async function submit() {
    if (!draft.name.trim()) return setError("Informe o nome do produto.");
    const input = toProductInput(destination, draft);
    if (initial && (initial.imageUrl ?? "") === draft.imageUrl) delete input.imageUrl;
    const invalidImage = imageFile ? null : validateStoreImageUrl(input.imageUrl ?? "");
    setImageError(invalidImage);
    if (invalidImage) return imageRef.current?.focus();
    setSaving(true);
    setError(null);
    try {
      if (imageFile) {
        const uploaded = await uploadImage("PRODUCT", imageFile);
        if (!uploaded.ok) return setImageError(uploaded.error);
        input.imageUrl = uploaded.data.image.url;
        patch({ imageUrl: input.imageUrl });
        setImageFile(null);
        if (fileRef.current) fileRef.current.value = "";
      }
      const failure = await onSave(input, initial?.id);
      if (failure) return setError(failure);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} labelledBy="product-form-title" width={520} sheetOnMobile>
      <div className="catalogo-form">
        <h2 id="product-form-title">{initial ? "Editar produto" : "Novo produto"}</h2>

        <div className="catalogo-form__row">
          <input placeholder="Nome" maxLength={80} value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
          <div className="catalogo-form__price">
            <MoneyInput name="product-price" value={draft.price} onChange={(price) => patch({ price })} />
          </div>
        </div>
        <input
          placeholder="Descrição (opcional)"
          maxLength={300}
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
        {categories && categories.length > 1 && <label className="catalogo-field">Categoria
          <select value={destination} disabled={saving} onChange={(event) => setDestination(event.target.value)}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>}
        <fieldset className="catalogo-photo" disabled={saving}>
          <legend>Foto do produto</legend>
          <label>
            Enviar JPEG, PNG ou WebP de até 8 MB
            <input ref={fileRef} type="file" accept={IMAGE_FILE_ACCEPT} aria-describedby={imageError ? imageErrorId : undefined} onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              if (file && (file.size > MAX_IMAGE_BYTES || !IMAGE_FILE_ACCEPT.split(",").includes(file.type))) {
                setImageError("Escolha uma imagem JPEG, PNG ou WebP de até 8 MB.");
                setImageFile(null);
                event.target.value = "";
                return;
              }
              setImageError(null);
              setImageFile(file);
            }} />
          </label>
          <label>
            Ou use um link HTTPS
            <input
              ref={imageRef}
              placeholder="https://"
              maxLength={500}
              inputMode="url"
              aria-label="URL da foto do produto (opcional)"
              aria-invalid={imageError && !imageFile ? true : undefined}
              aria-describedby={imageError ? imageErrorId : undefined}
              disabled={Boolean(imageFile)}
              value={draft.imageUrl}
              onChange={(event) => { patch({ imageUrl: event.target.value }); setImageError(null); }}
            />
          </label>
          {imageFile && <button type="button" className="catalogo__btn" onClick={() => {
            setImageFile(null);
            if (fileRef.current) fileRef.current.value = "";
          }}>Remover arquivo selecionado</button>}
          {imageError && <p id={imageErrorId} role="alert" className="catalogo__error">{imageError}</p>}
        </fieldset>

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
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
