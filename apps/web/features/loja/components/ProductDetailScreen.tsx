import { useState } from "react";
import type { Product } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import { STORE_CLOSED_MESSAGE } from "../checkoutForm";
import { InfoIcon } from "../icons";

// Tela cheia de detalhe do produto: foto, descrição, adicionais, observação e a barra fixa
// com quantidade + Adicionar. Não conhece carrinho — só devolve o que o cliente escolheu.
export function ProductDetailScreen({
  product,
  logoUrl,
  closed = false,
  onClose,
  onConfirm,
}: {
  product: Product;
  logoUrl: string | null;
  // Loja fechada/pausada/em consulta: o produto continua visível, mas não dá para adicionar.
  closed?: boolean;
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
        <button type="button" onClick={onClose} className="loja__detail-back" aria-label="Voltar ao cardápio">
          <span aria-hidden="true">‹</span>
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
            <label className="loja__notes-label" htmlFor="loja-observacao">
              Alguma observação?
            </label>
            <textarea id="loja-observacao" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="loja__notes-input" />
          </div>
        </div>
      </div>

      {closed ? (
        <div className="loja__detail-footer loja__detail-footer--closed">
          <p className="loja__closed" role="status">
            <InfoIcon />
            <span>{STORE_CLOSED_MESSAGE}.</span>
          </p>
          <button type="button" onClick={onClose} className="loja__cta">
            Voltar ao cardápio
          </button>
        </div>
      ) : (
        <div className="loja__detail-footer">
          <div className="loja__stepper" role="group" aria-label="Quantidade">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className={`loja__step${quantity <= 1 ? " loja__step--off" : ""}`}
              aria-label={`Diminuir quantidade de ${product.name}`}
              disabled={quantity <= 1}
            >
              −
            </button>
            <span className="loja__stepper-qty" role="status" aria-label={`Quantidade: ${quantity}`}>
              {quantity}
            </span>
            <button type="button" onClick={() => setQuantity((q) => q + 1)} className="loja__step" aria-label={`Aumentar quantidade de ${product.name}`}>
              +
            </button>
          </div>
          <button type="button" onClick={() => onConfirm({ quantity, additionalIds, notes: notes.trim() })} className="loja__add">
            <span>Adicionar</span>
            <span>{formatCents(lineTotal)}</span>
          </button>
        </div>
      )}
    </main>
  );
}
