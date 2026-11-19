"use client";

import { useState, type ReactNode } from "react";
import type { Category, Product, ProductAvailability, ProductInput } from "@/core/domain/catalog";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { categoryDeleteCopy, productDeleteCopy, productToInput } from "../deleteFlow";
import { ProductForm } from "./ProductForm";
import { ProductRow } from "./ProductRow";
import { CatalogOrderButtons } from "./CatalogOrderButtons";

type CategorySectionProps = {
  category: Category;
  visibleProducts?: Product[];
  onUpdateIcon: (id: string, icon: string) => void;
  // Cada ação devolve a mensagem de erro da API, ou null se deu certo.
  onDeleteCategory: (id: string) => Promise<string | null>;
  onDeleteProduct: (id: string) => Promise<string | null>;
  onSaveProduct: (input: ProductInput, productId?: string) => Promise<string | null>;
  onAvailability?: (id: string, value: ProductAvailability) => Promise<string | null>;
  canDelete?: boolean;
  actions?: ReactNode;
  categories?: Pick<Category, "id" | "name">[];
  onProductGroups?: (product: Product) => void;
  onMoveProduct?: (id: string, direction: -1 | 1) => void;
  ordering?: boolean;
};

type Pending = { kind: "product"; product: Product } | { kind: "category" } | null;

// Uma categoria com seus produtos. Qual produto está aberto no formulário é estado só daqui.
export function CategorySection({ category, visibleProducts = category.products, onUpdateIcon, onDeleteCategory, onDeleteProduct, onSaveProduct, onAvailability, canDelete = true, actions, categories, onProductGroups, onMoveProduct, ordering = false }: CategorySectionProps) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = pending ? (pending.kind === "product" ? productDeleteCopy(pending.product) : categoryDeleteCopy(category)) : null;

  function close() {
    if (busy) return;
    setPending(null);
    setError(null);
  }

  // Roda a ação; erro da API aparece DENTRO da janela (nada de alert() nativo) e a janela continua aberta.
  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const failure = await action();
    setBusy(false);
    if (failure) return setError(failure);
    setPending(null);
  }

  function confirm() {
    if (!pending || !copy) return;
    if (copy.informOnly) return close();
    if (pending.kind === "category") return void run(() => onDeleteCategory(category.id));
    const product = pending.product;
    // Produto ativo: o botão principal OCULTA (reversível). Produto já oculto: o principal é excluir.
    if (product.active) return void run(() => onSaveProduct(productToInput(product, category.id, { active: false }), product.id));
    void run(() => onDeleteProduct(product.id));
  }

  function deleteForever() {
    if (pending?.kind === "product") void run(() => onDeleteProduct(pending.product.id));
  }

  return (
    <section className="catalogo-category">
      <header className="catalogo-category__header">
        <h2>
          <input
            defaultValue={category.icon ?? ""}
            placeholder="emoji"
            maxLength={4}
            aria-label={`Emoji da categoria ${category.name}`}
            onBlur={(event) => {
              if (event.target.value !== (category.icon ?? "")) onUpdateIcon(category.id, event.target.value);
            }}
          />
          {category.name}
        </h2>
        <div className="catalogo-category__actions">
          {actions}
          {canDelete && <button type="button" className="catalogo__link catalogo__link--danger" onClick={() => setPending({ kind: "category" })}>
            excluir categoria
          </button>}
        </div>
      </header>

      <div className="catalogo-category__products">
        {visibleProducts.map((product, index) => (
          <ProductRow
            key={product.id}
            product={product}
            onEdit={() => setEditing(product)}
            onAvailability={onAvailability}
            onDelete={canDelete ? () => setPending({ kind: "product", product }) : undefined}
            onGroups={onProductGroups ? () => onProductGroups(product) : undefined}
            orderActions={onMoveProduct && <CatalogOrderButtons label={product.name} first={index === 0} last={index === visibleProducts.length - 1}
              busy={ordering} onMove={(direction) => onMoveProduct(product.id, direction)} />}
          />
        ))}
        <button type="button" className="catalogo__link" onClick={() => setAdding(true)}>
          + novo produto
        </button>
      </div>

      {editing && (
        <ProductForm categoryId={category.id} categories={categories} initial={editing} onSave={onSaveProduct} onClose={() => setEditing(null)} />
      )}
      {adding && <ProductForm categoryId={category.id} onSave={onSaveProduct} onClose={() => setAdding(false)} />}

      {copy && (
        <ConfirmDialog
          open
          title={copy.title}
          message={copy.message}
          confirmLabel={busy ? "Aguarde…" : copy.confirmLabel}
          tone={copy.confirmTone}
          busy={busy}
          error={error}
          alternative={copy.alternativeLabel ? { label: copy.alternativeLabel, onClick: deleteForever } : undefined}
          hideCancel={copy.informOnly}
          onConfirm={confirm}
          onCancel={close}
        />
      )}
    </section>
  );
}
