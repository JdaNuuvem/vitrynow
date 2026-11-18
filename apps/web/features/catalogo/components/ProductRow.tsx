"use client";

import type { Product } from "@/core/domain/catalog";
import { formatCents } from "@/shared/format/money";

export function ProductRow({ product, onEdit, onDelete }: { product: Product; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="catalogo-product">
      <div className="catalogo-product__info">
        {product.imageUrl && <img src={product.imageUrl} alt="" />}
        <span>
          <strong>{product.name}</strong> · {formatCents(product.priceCents)}
          {!product.active && <span className="catalogo-product__tag catalogo-product__tag--off">(inativo)</span>}
          {product.featured && <span className="catalogo-product__tag catalogo-product__tag--featured">★ destaque</span>}
          {product.additionals.length > 0 && (
            <span className="catalogo-product__tag">· {product.additionals.length} adicional(is)</span>
          )}
        </span>
      </div>
      <div className="catalogo-product__actions">
        <button type="button" className="catalogo__btn" onClick={onEdit}>
          editar
        </button>
        <button type="button" className="catalogo__btn catalogo__btn--danger" onClick={onDelete}>
          excluir
        </button>
      </div>
    </div>
  );
}
