"use client";

import { CategorySection } from "./components/CategorySection";
import { NewCategoryForm } from "./components/NewCategoryForm";
import { useCatalogo } from "./hooks/useCatalogo";
import "./catalogo.css";

export function CatalogoPage() {
  const catalogo = useCatalogo();

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
            onDeleteCategory={catalogo.deleteCategory}
            onDeleteProduct={catalogo.deleteProduct}
            onSaveProduct={catalogo.saveProduct}
          />
        ))}
      </div>
    </main>
  );
}
