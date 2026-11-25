"use client";

import { useId, useState } from "react";
import type { Category, Product } from "@/core/domain/catalog";
import { useBrokenImage } from "@/features/loja/hooks/useBrokenImage";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { Modal } from "@/shared/ui/Modal";
import { ProductOptionFields } from "@/features/loja/components/ProductOptionFields";
import { editableSelections, lineChoicesValid, startingPrice } from "@/features/loja/productOptions";
import { lineCents, type DraftLine } from "./manualOrder";

function ProductTile({ product, onClick }: { product: Product; onClick: () => void }) {
  const image = useBrokenImage(product.imageUrl);
  const soldOut = product.soldOut && (!product.soldOutUntil || Date.parse(product.soldOutUntil) > Date.now());
  return <button type="button" className="manual-tile" onClick={onClick} disabled={product.unavailableByOptions}>
    <span className="manual-tile__photo" aria-hidden="true">
      {product.imageUrl && !image.failed
        ? <img ref={image.ref} onError={image.onError} src={product.imageUrl} alt="" width={180} height={112} loading="lazy" />
        : <Icon name="products" size={32} />}
    </span>
    <span className="manual-tile__body">
      <strong>{product.name}</strong>{product.unavailableByOptions ? <small>Opções obrigatórias indisponíveis</small> : soldOut && <small>Esgotado no cardápio</small>}
      <span>{startingPrice(product)} <b aria-hidden="true">+</b></span>
    </span>
  </button>;
}

export function ManualCatalog({ categories, configure, disabled }: { categories: Category[]; configure: (product: Product) => void; disabled: boolean }) {
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const eligible = categories.filter((c) => c.products.some((p) => p.active));
  const search = query.trim().toLocaleLowerCase("pt-BR");
  const products = eligible.filter((c) => !category || c.id === category).flatMap((c) => c.products)
    .filter((p) => p.active && p.name.toLocaleLowerCase("pt-BR").includes(search));
  return <section className="manual-catalog" aria-label="Catálogo">
    <div className="manual-heading"><h2>Cardápio</h2>
      <label className="manual-search"><Icon name="search" size={18}/><input type="search" aria-label="Buscar produto" placeholder="Buscar produto" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    </div>
    <div className="manual-tabs" aria-label="Categorias" role="group">
      <button type="button" aria-pressed={!category} onClick={()=>setCategory("")}>Todos</button>
      {eligible.map(c=><button type="button" key={c.id} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)}>{c.name}</button>)}
    </div>
    <fieldset className="manual-catalog__items" disabled={disabled} aria-label="Produtos">
      {products.map(p=><ProductTile key={p.id} product={p} onClick={() => configure(p)}/>)}
    </fieldset>
    {!products.length && <p className="manual-muted">Nenhum produto encontrado.</p>}
  </section>;
}

export function ManualItemDialog({ initialLine, editing, save, onClose }: {
  initialLine: DraftLine;
  editing: boolean;
  save: (line: DraftLine) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [draft, setDraft] = useState(() => ({
    ...initialLine,
    additionalIds: initialLine.additionalIds.filter((id) => initialLine.product.additionals.some((entry) => entry.id === id)),
    optionSelections: editableSelections(initialLine.product.optionGroups ?? [], initialLine.optionSelections ?? []),
  }));
  const valid = lineChoicesValid(draft.product, draft) && !draft.product.unavailableByOptions;
  return (
    <Modal open onClose={onClose} labelledBy={titleId} sheetOnMobile fitContent>
      <form className="manual-options" onSubmit={(event) => {
        event.preventDefault();
        if (valid) save(draft);
      }}>
        <h2 id={titleId}>{draft.product.name}</h2>
        <p>{startingPrice(draft.product)}</p>
        {draft.product.optionGroups?.map((group) => (
          <ProductOptionFields
            key={group.id}
            group={group}
            selections={draft.optionSelections}
            onChange={(optionSelections) => setDraft({ ...draft, optionSelections })}
          />
        ))}
        {draft.product.additionals.some(a=>a.id) && <fieldset><legend>Adicionais</legend>
          {draft.product.additionals.map(a=>a.id && <label key={a.id} className="manual-check">
            <input type="checkbox" checked={draft.additionalIds.includes(a.id)} onChange={e=>{
              const id=a.id!;
              setDraft({...draft,additionalIds:e.target.checked?[...draft.additionalIds,id]:draft.additionalIds.filter(x=>x!==id)});
            }} disabled={!draft.additionalIds.includes(a.id) && draft.additionalIds.length>=50} />
            {a.name} · {formatCents(a.priceCents)}
          </label>)}
        </fieldset>}
        <label>Quantidade<input required type="number" min={1} max={100} value={draft.quantity || ""} onChange={e=>setDraft({...draft,quantity:Number(e.target.value)})}/></label>
        <label>Observação do item<textarea maxLength={150} value={draft.notes} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
        <div className="manual-actions"><button type="button" onClick={onClose}>Voltar</button>
          <button type="submit" className="manual-primary" disabled={!valid}>{editing ? "Salvar item" : "Adicionar"} · {formatCents(lineCents(draft))}</button></div>
      </form>
    </Modal>
  );
}
