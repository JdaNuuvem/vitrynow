import Link from "next/link";
import { useEffect, useState } from "react";
import type { Product } from "@/core/domain/catalog";
import { useStoreActions, useStoreCatalog } from "@/features/shell/StoreProvider";
import { Icon } from "@/shared/icons/Icon";
import { Shine } from "@/shared/ui/Shine";
import { useBrokenImage } from "@/features/loja/hooks/useBrokenImage";

type InventoryFilter = "soldOut" | "hidden" | "all";
function CatalogImage({ src }: { src: string | null }) {
  const image = useBrokenImage(src || "");
  if (!src || image.failed) return <span className="inicio-stock__image"><Icon name="products" size={20} /></span>;
  return <img className="inicio-stock__image" ref={image.ref} src={src} alt="" loading="lazy" onError={image.onError} />;
}

function availability(product: Product, now: number): InventoryFilter {
  if (product.active === false) return "hidden";
  if (product.soldOut && (!product.soldOutUntil || Date.parse(product.soldOutUntil) > now)) return "soldOut";
  return "all";
}

export function InventoryCard() {
  const { categories, error } = useStoreCatalog();
  const { refreshCatalog } = useStoreActions();
  const [filter, setFilter] = useState<InventoryFilter>("soldOut");
  useEffect(() => {
    const update = () => { if (!document.hidden) void refreshCatalog(); };
    const timer = window.setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refreshCatalog]);
  const now = Date.now();
  const items = categories?.flatMap((category) => category.products.map((product) => ({
    product,
    category: category.name,
    state: availability(product, now),
  }))).filter((row) => filter === "all" || row.state === filter);

  return (
    <section className="inicio-card inicio-stock">
      <div className="inicio-stock__head">
        <h2>Itens do cardápio</h2>
        <select aria-label="Filtrar itens do cardápio" value={filter} onChange={(event) => setFilter(event.target.value as InventoryFilter)}>
          <option value="soldOut">Esgotados</option><option value="hidden">Ocultos</option><option value="all">Todos</option>
        </select>
      </div>
      <div className="inicio-stock__list" aria-busy={!items && !error}>
        {error && <div className="inicio-stock__empty"><p>{error}</p><button type="button" onClick={() => void refreshCatalog()}>Tentar novamente</button></div>}
        {!items && !error && <Shine height={100} />}
        {items?.length === 0 && <div className="inicio-stock__empty"><Icon name="products" size={24} /><p>{filter === "soldOut" ? "Nenhum item esgotado." : filter === "hidden" ? "Nenhum item oculto." : "Nenhum produto cadastrado."}</p></div>}
        {items?.slice(0, 24).map(({ product, category, state }) => (
          <div className="inicio-stock__item" key={product.id}>
            <CatalogImage src={product.imageUrl} />
            <div><strong>{product.name}</strong><small>{category} · {state === "soldOut" ? "Esgotado" : state === "hidden" ? "Oculto" : "Disponível"}</small></div>
          </div>
        ))}
        {items && items.length > 24 && <p className="inicio-muted">Exibindo 24 de {items.length} itens.</p>}
      </div>
      <Link className="inicio-queue__foot" href="/dashboard/catalogo">Gerenciar cardápio <Icon name="chevronRight" size={15} /></Link>
    </section>
  );
}
