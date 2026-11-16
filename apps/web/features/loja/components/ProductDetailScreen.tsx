import { useState } from "react";
import type { Product } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";

// Tela cheia de detalhe do produto: foto, descrição, adicionais, observação e a barra fixa
// com quantidade + Adicionar. Não conhece carrinho — só devolve o que o cliente escolheu.
export function ProductDetailScreen({
  product,
  logoUrl,
  onClose,
  onConfirm,
}: {
  product: Product;
  logoUrl: string | null;
  onClose: () => void;
  onConfirm: (choice: { quantity: number; additionalIds: string[]; notes: string }) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [additionalIds, setAdditionalIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const additionalsCents = additionalIds.reduce(
    (sum, id) => sum + (product.additionals.find((a) => a.id === id)?.priceCents ?? 0),
    0,
  );
  const lineTotal = (product.priceCents + additionalsCents) * quantity;

  return (
    <main className="loja__screen">
      <div className="loja__detail-bar">
        <button onClick={onClose} className="loja__detail-back">
          ‹
        </button>
        {logoUrl && <img src={logoUrl} alt="" className="loja__detail-logo" />}
      </div>

      <div className="loja__screen-body">
        <div className="loja__hero">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} />
          ) : (
            <span className="loja__hero-fallback">🍽️</span>
          )}
        </div>

        <div className="loja__detail-content">
          <h1 className="loja__detail-title">{product.name}</h1>
          {product.description && <p className="loja__detail-desc">{product.description}</p>}

          {product.additionals.length > 0 && (
            <div className="loja__additionals">
              <div className="loja__additionals-title">Adicionais</div>
              <div className="loja__additionals-list">
                {product.additionals.map((additional) => (
                  <label key={additional.id} className="loja__additional">
                    <span className="loja__additional-name">
                      <input
                        type="checkbox"
                        checked={additionalIds.includes(additional.id)}
                        onChange={(e) =>
                          setAdditionalIds((prev) =>
                            e.target.checked ? [...prev, additional.id] : prev.filter((id) => id !== additional.id),
                          )
                        }
                      />
                      {additional.name}
                    </span>
                    <span className="loja__additional-price">+{formatCents(additional.priceCents)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="loja__notes">
            <label className="loja__notes-label">Alguma observação?</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="loja__notes-input" />
          </div>
        </div>
      </div>

      <div className="loja__detail-footer">
        <div className="loja__stepper">
          <button
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            className={`loja__step${quantity <= 1 ? " loja__step--off" : ""}`}
          >
            −
          </button>
          <span className="loja__stepper-qty">{quantity}</span>
          <button onClick={() => setQuantity((q) => q + 1)} className="loja__step">
            +
          </button>
        </div>
        <button onClick={() => onConfirm({ quantity, additionalIds, notes: notes.trim() })} className="loja__add">
          <span>Adicionar</span>
          <span>{formatCents(lineTotal)}</span>
        </button>
      </div>
    </main>
  );
}
