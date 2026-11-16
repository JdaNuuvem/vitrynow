"use client";

import { CategorySection } from "./components/CategorySection";
import { NewCategoryForm } from "./components/NewCategoryForm";
import { useCatalogo } from "./hooks/useCatalogo";
import "./catalogo.css";

export function CatalogoPage() {
  const catalogo = useCatalogo();

  // Erros de exclusão (ex.: categoria que ainda tem produtos, 409) vêm da API em texto pronto.
  async function alertOnFailure(action: Promise<string | null>) {
    const failure = await action;
    if (failure) alert(failure);
  }

  return (
    <main className="catalogo">
      <h1>Catálogo</h1>

      <NewCategoryForm onCreate={catalogo.createCategory} />

      <div className="catalogo__list">
        {catalogo.categories.map((category) => (
          <CategorySection
            key={category.id}
            category={category}
            onUpdateIcon={catalogo.updateCategoryIcon}
            onDeleteCategory={(id) => alertOnFailure(catalogo.deleteCategory(id))}
            onDeleteProduct={(id) => alertOnFailure(catalogo.deleteProduct(id))}
            onSaveProduct={catalogo.saveProduct}
          />
        ))}
      </div>
    </main>
  );
}
