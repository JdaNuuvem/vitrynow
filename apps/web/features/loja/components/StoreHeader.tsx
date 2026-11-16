import { useState } from "react";
import type { StoreInfo } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import { ChatIcon, CoinIcon, PinIcon, SearchIcon } from "../icons";

// Cabeçalho da loja: banner, logo, dados de contato, status de funcionamento e a barra que
// abre a busca (a busca em si é outra tela — ver SearchScreen). Única responsabilidade aqui
// é mostrar "quem é a loja" e dar entrada pra busca/categorias.
export function StoreHeader({
  store,
  isOpenNow,
  onOpenSearch,
  children,
}: {
  store: StoreInfo;
  isOpenNow: boolean | null;
  onOpenSearch: () => void;
  children?: React.ReactNode;
}) {
  const [showHours, setShowHours] = useState(false);
  const whatsappLink = store.whatsapp ? `https://wa.me/${store.whatsapp}` : null;
  const minOrderCents = store.minOrderCents;

  return (
    <div>
      <div className="loja__cover">{store.coverImageUrl && <img src={store.coverImageUrl} alt="" />}</div>

      <div className="loja__card">
        <div className="loja__card-top">
          <div className="loja__identity">
            <div className="loja__logo">{store.logoUrl && <img src={store.logoUrl} alt={store.name} />}</div>
            <div className="loja__info">
              <h1 className="loja__name">{store.name}</h1>
              {store.address && (
                <p className="loja__line loja__line--top">
                  <PinIcon />
                  <span>{store.address}</span>
                </p>
              )}
              {minOrderCents !== null && (
                <p className="loja__line">
                  <CoinIcon /> Pedido mínimo {formatCents(minOrderCents)}
                </p>
              )}
            </div>
          </div>
          {whatsappLink && (
            <a href={whatsappLink} target="_blank" rel="noreferrer" className="loja__whatsapp" title="Falar no WhatsApp">
              <ChatIcon />
            </a>
          )}
        </div>

        {store.openingHours && (
          <div className="loja__status">
            {isOpenNow === null ? (
              <span className="loja__status-muted">Horário de funcionamento</span>
            ) : isOpenNow ? (
              <span className="loja__status-state loja__status-state--open">
                <span className="loja__dot loja__dot--open" /> Aberto agora
              </span>
            ) : (
              <span className="loja__status-state loja__status-state--closed">
                <span className="loja__dot loja__dot--closed" /> Fechado agora
              </span>
            )}
            <button onClick={() => setShowHours((v) => !v)} className="loja__link">
              Ver horários {showHours ? "▲" : "▼"}
            </button>
          </div>
        )}
        {showHours && store.openingHours && <p className="loja__hours">{store.openingHours}</p>}

        <button onClick={onOpenSearch} className="loja__search">
          <span className="loja__search-icon">
            <SearchIcon />
          </span>
          Pesquisar...
        </button>

        {children}
      </div>
    </div>
  );
}
