import type { Category } from "@/core/domain/storefront";
import { CloseIcon } from "../icons";

// Tela cheia Categorias (aberta via Ver todas) — lista vertical de botões cinza com
// ícone + nome, igual à tela de referência. Clicar leva até a seção no cardápio.
export function CategoriesScreen({
  categories,
  onClose,
  onSelect,
}: {
  categories: Category[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <main className="loja__screen">
      <div className="loja__screen-bar loja__screen-bar--between">
        <h1 className="loja__screen-title">Categorias</h1>
        <button onClick={onClose} className="loja__close">
          <CloseIcon />
        </button>
      </div>
      <div className="loja__screen-body loja__screen-body--stack">
        {categories.map((category) => (
          <button key={category.id} onClick={() => onSelect(category.id)} className="loja__category-button">
            {category.icon && <span className="loja__category-icon">{category.icon}</span>}
            {category.name}
          </button>
        ))}
      </div>
    </main>
  );
}
