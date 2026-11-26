"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Category, Product } from "@/core/domain/catalog";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { PageHeading } from "@/shared/design/components";
import { Icon } from "@/shared/icons/Icon";
import { CatalogOrderButtons, moveId } from "./components/CatalogOrderButtons";
import { CategoryManagementDialog } from "./components/CategoryManagementDialog";
import { CategorySection } from "./components/CategorySection";
import { NewCategoryForm } from "./components/NewCategoryForm";
import { useCatalogo } from "./hooks/useCatalogo";
import { ProductGroupsDialog } from "./groups/ProductGroupsDialog";
import "./catalogo.css";

export function CatalogoPage() {
  const catalogo = useCatalogo();
  const role = useCurrentRole();
  const [query, setQuery] = useState("");
  const [categoryDialog, setCategoryDialog] = useState<{ kind: "edit" | "move"; category: Category } | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const orderingRef = useRef(false);
  const term = query.trim().toLocaleLowerCase("pt-BR");
  const sections = catalogo.categories.map((category) => ({
    category,
    products: category.name.toLocaleLowerCase("pt-BR").includes(term)
      ? category.products
      : category.products.filter((product) => product.name.toLocaleLowerCase("pt-BR").includes(term)),
  })).filter(({ category, products }) => !term || products.length > 0 || category.name.toLocaleLowerCase("pt-BR").includes(term));

  async function reorder(ids: string[] | null, save: (ids: string[]) => Promise<string | null>) {
    if (!ids || orderingRef.current) return;
    orderingRef.current = true;
    setOrdering(true);
    setActionMessage(null);
    try {
      const error = await save(ids);
      setActionMessage({ failed: !!error, text: error ?? "Ordem atualizada." });
    } finally {
      orderingRef.current = false;
      setOrdering(false);
    }
  }

  async function moveProducts(fromId: string, toId: string) {
    const failure = await catalogo.moveProducts(fromId, toId);
    if (!failure) setActionMessage({ failed: false, text: "Produtos movidos." });
    return failure;
  }

  return (
    <main className="catalogo">
      <PageHeading title="Catálogo" description="Organize seus produtos, categorias e opções do cardápio."
        actions={<>
          {role === "OWNER" && <Link className="ds-button ds-button--secondary" href="/dashboard/catalogo/importar">Importar planilha</Link>}
          <Link className="ds-button ds-button--secondary" href="/dashboard/catalogo/opcoes"><Icon name="products" size={18} /> Grupos de opções</Link>
        </>} />

      <div className="catalogo__tools">
        <NewCategoryForm onCreate={catalogo.createCategory} />
        <input type="search" aria-label="Buscar produto ou categoria" placeholder="Buscar produto ou categoria" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      {catalogo.loading && <p role="status">Carregando catálogo…</p>}
      {catalogo.error && <div className="catalogo__notice" role="alert">
        {catalogo.error}
        <button type="button" className="catalogo__btn" disabled={catalogo.loading} onClick={catalogo.reload}>Tentar novamente</button>
      </div>}
      {actionMessage && <p className={`catalogo__notice${actionMessage.failed ? " catalogo__notice--error" : ""}`}
        role={actionMessage.failed ? "alert" : "status"}>{actionMessage.text}</p>}
      {!catalogo.loading && !catalogo.error && !sections.length &&
        <p className="catalogo__notice" role="status">{term ? "Nenhum produto ou categoria encontrado." : "Crie a primeira categoria para cadastrar seus produtos."}</p>}

      <div className="catalogo__list">
        {sections.map(({ category, products }, index) => (
          <CategorySection
            key={category.id}
            category={category}
            visibleProducts={products}
            onUpdateIcon={catalogo.updateCategoryIcon}
            onDeleteCategory={catalogo.deleteCategory}
            onDeleteProduct={catalogo.deleteProduct}
            onSaveProduct={catalogo.saveProduct}
            onAvailability={catalogo.setAvailability}
            canDelete={role === "OWNER"}
            categories={catalogo.categories}
            onProductGroups={setProduct}
            ordering={ordering || catalogo.loading}
            onMoveProduct={term ? undefined : (id, direction) => void reorder(moveId(category.products.map((row) => row.id), id, direction),
              (ids) => catalogo.reorderProducts(category.id, ids))}
            actions={<>
              {!term && sections.length > 1 && <CatalogOrderButtons label={`categoria ${category.name}`} first={index === 0} last={index === sections.length - 1}
                busy={ordering || catalogo.loading}
                onMove={(direction) => void reorder(moveId(catalogo.categories.map((row) => row.id), category.id, direction), catalogo.reorderCategories)} />}
              <button className="catalogo__btn" type="button" onClick={() => setCategoryDialog({ kind: "edit", category })}>Editar categoria</button>
              {category.products.length > 0 && catalogo.categories.length > 1 && <button className="catalogo__btn" type="button"
                onClick={() => setCategoryDialog({ kind: "move", category })}>Mover produtos</button>}
            </>}
          />
        ))}
      </div>
      {categoryDialog?.kind === "edit" && <CategoryManagementDialog kind="edit" category={categoryDialog.category}
        onClose={() => setCategoryDialog(null)} onSave={(input) => catalogo.updateCategory(categoryDialog.category.id, input)} />}
      {categoryDialog?.kind === "move" && <CategoryManagementDialog kind="move" category={categoryDialog.category}
        destinations={catalogo.categories.filter((row) => row.id !== categoryDialog.category.id)}
        onClose={() => setCategoryDialog(null)} onSave={(id) => moveProducts(categoryDialog.category.id, id)} />}
      {product && <ProductGroupsDialog product={product} onClose={() => setProduct(null)} onChange={catalogo.reload} />}
    </main>
  );
}
