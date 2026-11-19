"use client";

import { useState, type ReactNode } from "react";
import type { Product, ProductAvailability } from "@/core/domain/catalog";
import { useBrokenImage } from "@/features/loja/hooks/useBrokenImage";
import { startingPrice } from "@/features/loja/productOptions";
import { StatusBadge } from "@/shared/design/components";
import { Icon } from "@/shared/icons/Icon";

type ProductRowProps = {
  product: Product;
  onEdit: () => void;
  onDelete?: () => void;
  onGroups?: () => void;
  orderActions?: ReactNode;
  onAvailability?: (id: string, value: ProductAvailability) => Promise<string | null>;
};

export function ProductRow({ product, onEdit, onDelete, onAvailability, onGroups, orderActions }: ProductRowProps) {
  const photo = useBrokenImage(product.imageUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soldOut = product.soldOut && (!product.soldOutUntil || Date.parse(product.soldOutUntil) > Date.now());
  const availability = soldOut ? (product.soldOutUntil ? "TODAY" : "MANUAL") : "AVAILABLE";
  const groups = product.optionGroups?.length ?? 0;
  const additionals = product.additionals.length;

  async function changeAvailability(value: ProductAvailability) {
    if (!onAvailability || saving) return;
    setSaving(true);
    setError(null);
    try {
      setError(await onAvailability(product.id, value));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="catalogo-product">
      <div className="catalogo-product__info">
        <span className="catalogo-product__photo" aria-hidden="true">
          {product.imageUrl && !photo.failed
            // eslint-disable-next-line @next/next/no-img-element -- As lojas podem usar hosts HTTPS arbitrários.
            ? <img src={product.imageUrl} ref={photo.ref} onError={photo.onError} alt="" width={52} height={52} loading="lazy" />
            : <Icon name="products" size={22} />}
        </span>
        <span>
          <strong>{product.name}</strong> <span className="catalogo-product__price">{startingPrice(product)}</span>
          <span className="catalogo-product__tags">
            {!product.active && <StatusBadge>Inativo</StatusBadge>}
            {product.featured && <StatusBadge tone="info">Destaque</StatusBadge>}
            {product.active && product.unavailableByOptions && <StatusBadge tone="warning">Opções obrigatórias indisponíveis</StatusBadge>}
            {groups > 0 && <StatusBadge>{groups === 1 ? "1 grupo de opções" : `${groups} grupos de opções`}</StatusBadge>}
            {groups === 0 && additionals > 0 && <StatusBadge>{additionals === 1 ? "1 adicional" : `${additionals} adicionais`}</StatusBadge>}
          </span>
        </span>
      </div>
      <div className="catalogo-product__actions">
        {orderActions}
        {product.active && onAvailability && (
          <select className="catalogo__btn" value={availability} disabled={saving} aria-label={`Disponibilidade de ${product.name}`}
            onChange={(event) => void changeAvailability(event.target.value as ProductAvailability)}>
            <option value="AVAILABLE">Disponível</option>
            <option value="TODAY">Esgotado hoje</option>
            <option value="MANUAL">Esgotado até reativar</option>
          </select>
        )}
        <button type="button" className="catalogo__btn" onClick={onEdit}>
          editar
        </button>
        {onGroups && <button type="button" className="catalogo__btn" onClick={onGroups} aria-label={`Grupos de opções de ${product.name}`}>Opções</button>}
        {onDelete && <button type="button" className="catalogo__btn catalogo__btn--danger" onClick={onDelete}>
          excluir
        </button>}
      </div>
      {error && <p role="alert" className="catalogo__error">{error}</p>}
    </div>
  );
}
