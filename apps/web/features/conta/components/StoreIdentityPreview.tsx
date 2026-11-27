import { useEffect, useMemo, useState } from "react";
import type { StoreSettings } from "@/core/domain/store";
import { StoreHeader } from "@/features/loja/components/StoreHeader";
import { ReelsMenu } from "@/features/loja/reels/ReelsMenu";
import { lojaThemeStyle } from "@/features/loja/theme";
import { useStoreCatalog } from "@/features/shell/StoreProvider";
import { validateStoreImageUrl } from "@/shared/format/imageUrl";
import type { ImageDraft } from "../aparencia/AppearanceImageField";
import "@/features/loja/loja.css";
import "@/features/loja/cardapio.css";

function previewUrl(value: string, saved: string | null) {
  if (value === saved && value === "/local-ramenku/fachada.webp") return value;
  return validateStoreImageUrl(value) === null ? value.trim() : "";
}

function usePreviewUrl({ url, file }: ImageDraft, saved: string | null) {
  const [src, setSrc] = useState(() => previewUrl(url, saved));
  useEffect(() => {
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setSrc(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    const timer = window.setTimeout(() => setSrc(previewUrl(url, saved)), 300);
    return () => window.clearTimeout(timer);
  }, [file, url, saved]);
  return src;
}

export function StoreIdentityPreview({ store, primaryColor, logo, cover, layout = "CLASSIC" }: {
  store: StoreSettings;
  primaryColor: string;
  logo: ImageDraft;
  cover: ImageDraft;
  layout?: "CLASSIC" | "REELS";
}) {
  const [wide, setWide] = useState(false);
  const { categories } = useStoreCatalog();
  const reelsCategories = useMemo(() => (categories ?? [])
    // adicionais não aparecem no feed; o tipo do catálogo do painel permite adicional ainda sem id
    .map((c) => ({ ...c, products: c.products.filter((p) => p.active).map((p) => ({ ...p, additionals: [] })) }))
    .filter((c) => c.products.length > 0), [categories]);
  const visibleCategories = categories?.filter(({ products }) => products.length > 0).slice(0, 3) ?? [];
  const logoUrl = usePreviewUrl(logo, store.logoUrl);
  const coverUrl = usePreviewUrl(cover, store.coverImageUrl);
  const [imageFailure, setImageFailure] = useState<string[]>([]);
  const previewStore = { ...store, logoUrl, coverImageUrl: coverUrl };

  return (
    <section className="appearance-preview" aria-labelledby="appearance-preview-heading" style={lojaThemeStyle(primaryColor)}>
      <div className="appearance-preview__tools">
        <h2 id="appearance-preview-heading">Prévia do cardápio</h2>
        <div className="appearance-preview__sizes" role="group" aria-label="Largura da prévia">
          <button type="button" aria-pressed={!wide} onClick={() => setWide(false)}>Celular</button>
          <button type="button" aria-pressed={wide} onClick={() => setWide(true)}>Desktop</button>
        </div>
      </div>
      <div className="appearance-preview__stage">
        <div className={`loja appearance-preview__frame${wide ? " appearance-preview__frame--wide" : ""}`} style={lojaThemeStyle(primaryColor)}
          onErrorCapture={(event) => {
            if (!(event.target instanceof HTMLImageElement)) return;
            const url = event.target.getAttribute("src");
            if (url) setImageFailure((current) => current.includes(url) ? current : [...current, url]);
          }}>
          {layout === "REELS" ? (
            // MODELO REELS: o mesmo feed do cardápio público, com os pratos ativos (desliza dentro da prévia; botões não fazem nada aqui)
            <div className="appearance-preview__reels">
              <ReelsMenu storeName={store.name} logoUrl={logoUrl || null} categories={reelsCategories} reels={[]} quantityByProduct={{}} closed={false}
                onAdd={() => {}} onOpen={() => {}} onShowList={() => {}} />
            </div>
          ) : (
            <>
              <StoreHeader preview store={previewStore} showCategoriesHead={false} onOpenSearch={() => {}} onViewAllCategories={() => {}} />
              <div className="appearance-preview__sample" aria-hidden="true">
                <div className="appearance-preview__categories">
                  {visibleCategories.length > 0
                    ? visibleCategories.map(({ id, name }) => <span key={id}>{name}</span>)
                    : <span>Categorias</span>}
                </div>
                <div className="appearance-preview__cart">Ver carrinho</div>
              </div>
            </>
          )}
        </div>
      </div>
      {layout === "REELS" ? <p className="appearance-preview__note">Na prévia aparecem as fotos; os vídeos publicados em Reels entram no lugar delas no cardápio.</p> : null}
      {(imageFailure.includes(logoUrl) || imageFailure.includes(coverUrl)) && (
        <p className="appearance-preview__note" role="status">Uma das imagens não carregou. Confira o endereço ou escolha outro arquivo.</p>
      )}
    </section>
  );
}
