"use client";

import { useState } from "react";
import type { Category, Product, ProductInput } from "@/core/domain/catalog";
import { ProductForm } from "./ProductForm";
import { ProductRow } from "./ProductRow";

type CategorySectionProps = {
  category: Category;
  onUpdateIcon: (id: string, icon: string) => void;
  onDeleteCategory: (id: string) => void;
  onDeleteProduct: (id: string) => void;
  onSaveProduct: (input: ProductInput, productId?: string) => Promise<string | null>;
};

// Uma categoria com seus produtos. Qual produto está aberto no formulário é estado só daqui.
export function CategorySection({ category, onUpdateIcon, onDeleteCategory, onDeleteProduct, onSaveProduct }: CategorySectionProps) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [adding, setAdding] = useState(false);

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
        <button type="button" className="catalogo__link catalogo__link--danger" onClick={() => onDeleteCategory(category.id)}>
          excluir categoria
        </button>
      </header>

      <div className="catalogo-category__products">
        {category.products.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            onEdit={() => setEditing(product)}
            onDelete={() => onDeleteProduct(product.id)}
          />
        ))}
        <button type="button" className="catalogo__link" onClick={() => setAdding(true)}>
          + novo produto
        </button>
      </div>

      {editing && (
        <ProductForm categoryId={category.id} initial={editing} onSave={onSaveProduct} onClose={() => setEditing(null)} />
      )}
      {adding && <ProductForm categoryId={category.id} onSave={onSaveProduct} onClose={() => setAdding(false)} />}
    </section>
  );
}
