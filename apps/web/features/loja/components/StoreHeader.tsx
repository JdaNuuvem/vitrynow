import { useState } from "react";
import { useBrokenImage } from "../hooks/useBrokenImage";
import type { StoreInfo } from "@/core/domain/storefront";
import { storeInitials } from "@/lib/storeInitials";
import { STORE_CLOSED_MESSAGE } from "../checkoutForm";
import { ChatIcon, ChevronIcon, CoinIcon, PinIcon, SearchIcon } from "../icons";
import { conditionsLine } from "../storeInfo";

// Cabeçalho do cardápio v2 (spec 12 §2): capa em largura total, folha branca que sobe sobre ela, logo redonda pela
// metade sobre a capa, identidade, caixa de status e busca. Só mostra "quem é a loja" e dá entrada à busca e às
// categorias; os chips e o carrinho moram fora (a barra de categorias fica fixa e precisa ser filha da página inteira).
export function StoreHeader({
  store,
  onOpenSearch,
  onViewAllCategories,
  showCategoriesHead,
}: {
  store: StoreInfo;
  onOpenSearch: () => void;
  onViewAllCategories: () => void;
  // Só há o que escolher com 2 categorias ou mais (mesma regra dos chips).
  showCategoriesHead: boolean;
}) {
  const [showHours, setShowHours] = useState(false);
  // URL de capa/logo pode estar quebrada (loja digitou errado, arquivo saiu do ar): cai no degradê / monograma, nunca
  // em ícone de imagem quebrada. Inclui a que falhou antes da hidratação (SSR).
  const cover = useBrokenImage(store.coverImageUrl);
  const logo = useBrokenImage(store.logoUrl);
  const hasCover = Boolean(store.coverImageUrl) && !cover.failed;
  const hasLogo = Boolean(store.logoUrl) && !logo.failed;
  const whatsappLink = store.whatsapp ? `https://wa.me/${store.whatsapp}` : null;
  const conditions = conditionsLine(store);
  const open = store.acceptingOrders;

  return (
    <>
      {/* Sem capa (ou capa quebrada): degradê da cor da loja, nunca faixa cinza (spec 12 §2.1). */}
      <div className={`loja__cover${hasCover ? "" : " loja__cover--empty"}`}>
        {hasCover && <img ref={cover.ref} src={store.coverImageUrl as string} alt="" onError={cover.onError} />}
      </div>

      <section className="loja__card" aria-label="Sobre a loja">
        {hasLogo ? (
          <div className="loja__logo">
            {/* alt vazio: o nome da loja já está no título ao lado (revisão da Da Vinci, N1) */}
            <img ref={logo.ref} src={store.logoUrl as string} alt="" onError={logo.onError} />
          </div>
        ) : (
          // Monograma (spec 12 §2.3): decorativo, o nome da loja vem logo abaixo.
          <div className="loja__logo loja__logo--initials" aria-hidden="true">
            {storeInitials(store.name)}
          </div>
        )}

        <div className="loja__ident">
          <div className="loja__ident-main">
            <div className="loja__name-row">
              <h1 className="loja__name">{store.name}</h1>
              {whatsappLink && (
                <a href={whatsappLink} target="_blank" rel="noreferrer" className="loja__whatsapp" title="Falar no WhatsApp" aria-label="Falar com a loja no WhatsApp (abre em outra aba)">
                  <ChatIcon />
                </a>
              )}
            </div>
            <div className="loja__info">
              {store.address && (
                <p className="loja__line loja__line--top">
                  <PinIcon />
                  <span>{store.address}</span>
                </p>
              )}
              {conditions && (
                <p className="loja__line">
                  <CoinIcon />
                  <span>{conditions}</span>
                </p>
              )}
            </div>
          </div>

          {/* Caixa de status. Sem o B5 (horário estruturado) o servidor não sabe a hora de fechar: só afirma o que sabe,
              se a loja está recebendo pedidos, e mostra o texto de horário que a loja cadastrou. */}
          <div className={`loja__status${open ? "" : " loja__status--closed"}`}>
            <div className="loja__status-head">
              <span className="loja__status-state">
                <span className={`loja__dot${open ? "" : " loja__dot--closed"}`} aria-hidden="true" />
                {open ? "Recebendo pedidos" : "Fechado agora"}
              </span>
              {store.openingHours && (
                <button type="button" className="loja__hours-button" aria-expanded={showHours} aria-controls="loja-horarios" onClick={() => setShowHours((value) => !value)}>
                  Ver horários
                  <span className={`loja__hours-chevron${showHours ? " loja__hours-chevron--open" : ""}`}>
                    <ChevronIcon />
                  </span>
                </button>
              )}
            </div>
            {!open && (
              <p className="loja__status-text" role="status">
                {STORE_CLOSED_MESSAGE}.
              </p>
            )}
            {store.openingHours && (
              <p id="loja-horarios" className="loja__hours" hidden={!showHours}>
                {store.openingHours}
              </p>
            )}
          </div>
        </div>

        <button type="button" onClick={onOpenSearch} className="loja__search">
          <span className="loja__search-icon">
            <SearchIcon size="md" />
          </span>
          Pesquisar...
        </button>

        {showCategoriesHead && (
          <div className="loja__categories-head">
            <h2 className="loja__categories-title">Categorias</h2>
            <button type="button" onClick={onViewAllCategories} className="loja__categories-all">
              Ver todas ›
            </button>
          </div>
        )}
      </section>
    </>
  );
}
