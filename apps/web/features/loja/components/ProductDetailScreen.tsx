import { useEffect, useRef, useState } from "react";
import type { CartLine, OptionSelection, Product } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { STORE_CLOSED_MESSAGE } from "../checkoutForm";
import { useBrokenImage } from "../hooks/useBrokenImage";
import { InfoIcon, MinusIcon, PlusIcon } from "../icons";
import { editableSelections, lineChoicesValid, startingPrice, unitPriceWithChoices } from "../productOptions";
import { ProductOptionFields } from "./ProductOptionFields";
import { Dish3dViewer } from "@/shared/dish3d/Dish3dViewer";
import "../purchase.css";
import "./hero3d.css";

// Tela cheia de detalhe do produto: foto, descrição, adicionais, observação e a barra fixa
// com quantidade + Adicionar. Não conhece carrinho — só devolve o que o cliente escolheu.
export function ProductDetailScreen({
  product,
  logoUrl,
  closed = false,
  initialChoice,
  onClose,
  onConfirm,
}: {
  product: Product;
  logoUrl: string | null;
  // Loja fechada/pausada/em consulta: o produto continua visível, mas não dá para adicionar.
  closed?: boolean;
  initialChoice?: CartLine;
  onClose: () => void;
  onConfirm: (choice: { quantity: number; additionalIds: string[]; optionSelections?: OptionSelection[]; notes: string }) => void;
}) {
  const groups = product.optionGroups ?? [];
  const [quantity, setQuantity] = useState(initialChoice?.quantity ?? 1);
  const [additionalIds, setAdditionalIds] = useState(() => initialChoice?.additionalIds.filter((id) => product.additionals.some((entry) => entry.id === id)) ?? []);
  const [optionSelections, setOptionSelections] = useState(() => editableSelections(groups, initialChoice?.optionSelections ?? []));
  const [notes, setNotes] = useState(initialChoice?.notes ?? "");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const photo = useBrokenImage(product.imageUrl);
  const logo = useBrokenImage(logoUrl);
  // PRATO 3D: com modelo publicado, a foto vira um botão "Ver em 3D" (gira com o dedo; "Ver na mesa" = realidade aumentada).
  const [show3d, setShow3d] = useState(false);

  // Tela nova: o foco entra no título (o leitor de tela anuncia o produto) em vez de ficar no body.
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  // Esc volta ao cardápio, exceto no meio de uma observação já escrita (não perde o texto sem querer).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLTextAreaElement && target.value.trim() !== "") return;
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const selectedOptions = editableSelections(groups, optionSelections);
  const availableAdditionals = additionalIds.filter((id) => product.additionals.some((entry) => entry.id === id));
  const choices = { additionalIds: availableAdditionals, optionSelections: selectedOptions };
  const lineTotal = unitPriceWithChoices(product, choices) * quantity;
  const valid = lineChoicesValid(product, choices);
  const unavailable = product.soldOut || product.unavailableByOptions;

  return (
    <main className="loja__screen loja__purchase-detail">
      <div className="loja__detail-bar">
        <button type="button" onClick={onClose} className="loja__detail-back" aria-label={initialChoice ? "Voltar ao carrinho" : "Voltar ao cardápio"}>
          <Icon name="chevronLeft" size={22} />
        </button>
        {logoUrl && !logo.failed && <img ref={logo.ref} src={logoUrl} onError={logo.onError} alt="" className="loja__detail-logo" />}
      </div>

      <div className="loja__screen-body">
        <div className="loja__hero">
          {show3d && product.model3dUrl ? (
            <Dish3dViewer src={product.model3dUrl} alt={`${product.name} em 3D`} poster={product.imageUrl} />
          ) : product.imageUrl && !photo.failed ? (
            <img ref={photo.ref} src={product.imageUrl} onError={photo.onError} alt={product.name} width={390} height={390} />
          ) : (
            <Icon name="products" size={64} />
          )}
          {product.model3dUrl ? (
            <button type="button" className="loja__hero-3d" aria-pressed={show3d} onClick={() => setShow3d((v) => !v)}>
              {show3d ? "Ver foto" : "Ver em 3D"}
            </button>
          ) : null}
        </div>

        <div className="loja__detail-content">
          <header className="loja__detail-intro">
            <div className="loja__detail-heading">
              <h1 ref={titleRef} tabIndex={-1} className="loja__detail-title">{product.name}</h1>
              <strong className="loja__detail-price">{startingPrice(product)}</strong>
            </div>
            {product.description && <p className="loja__detail-desc">{product.description}</p>}
          </header>

          {groups.map((group) => (
            <ProductOptionFields key={group.id} group={group} selections={selectedOptions} onChange={setOptionSelections} disabled={closed || unavailable} />
          ))}

          {product.additionals.length > 0 && (
            <fieldset className="loja__additionals" disabled={closed || unavailable}>
              <legend className="loja__additionals-title">Adicionais</legend>
              <div className="loja__additionals-list">
                {product.additionals.map((additional) => (
                  <label key={additional.id} className="loja__additional">
                    <span className="loja__additional-name">
                      <input
                        type="checkbox"
                        checked={availableAdditionals.includes(additional.id)}
                        disabled={!availableAdditionals.includes(additional.id) && availableAdditionals.length >= 50}
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
            </fieldset>
          )}

          <div className="loja__notes">
            <label className="loja__notes-label" htmlFor="loja-observacao">
              Alguma observação?
            </label>
            <textarea id="loja-observacao" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={150} className="loja__notes-input" />
          </div>
        </div>
      </div>

      {closed || unavailable ? (
        <div className="loja__detail-footer loja__detail-footer--closed">
          <p className="loja__closed" role="status">
            <InfoIcon />
            <span>{product.unavailableByOptions ? "As opções obrigatórias deste produto estão indisponíveis." : product.soldOut ? "Este produto está esgotado." : `${STORE_CLOSED_MESSAGE}.`}</span>
          </p>
          <button type="button" onClick={onClose} className="loja__cta">
            {initialChoice ? "Voltar ao carrinho" : "Voltar ao cardápio"}
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
              <MinusIcon />
            </button>
            <span className="loja__stepper-qty" role="status" aria-label={`Quantidade: ${quantity}`}>
              {quantity}
            </span>
            <button type="button" onClick={() => setQuantity((q) => Math.min(100, q + 1))} disabled={quantity >= 100} className="loja__step" aria-label={`Aumentar quantidade de ${product.name}`}>
              <PlusIcon />
            </button>
          </div>
          <button type="button" disabled={!valid} onClick={() => onConfirm({
            quantity,
            additionalIds: availableAdditionals,
            ...(selectedOptions.length ? { optionSelections: selectedOptions } : {}),
            notes: notes.trim(),
          })} className="loja__add" aria-label={`${initialChoice ? "Salvar item" : "Adicionar"} · ${formatCents(lineTotal)}`}>
            <span>{initialChoice ? "Salvar item" : "Adicionar"}</span>
            <span>{formatCents(lineTotal)}</span>
          </button>
        </div>
      )}
    </main>
  );
}
