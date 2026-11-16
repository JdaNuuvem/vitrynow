import { useState } from "react";
import { useBrokenImage } from "../hooks/useBrokenImage";
import type { StoreInfo } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import { storeInitials } from "@/lib/storeInitials";
import { ChatIcon, ChevronIcon, ClockIcon, CoinIcon, PinIcon, SearchIcon } from "../icons";

// Cabeçalho da loja: banner, logo, dados de contato, status de funcionamento e a barra que
// abre a busca (a busca em si é outra tela — ver SearchScreen). Única responsabilidade aqui
// é mostrar "quem é a loja" e dar entrada pra busca/categorias.
export function StoreHeader({
  store,
  onOpenSearch,
  children,
}: {
  store: StoreInfo;
  onOpenSearch: () => void;
  children?: React.ReactNode;
}) {
  const [showHours, setShowHours] = useState(false);
  // URL de capa/logo pode estar quebrada (loja digitou errado, arquivo saiu do ar): some o ícone
  // de imagem quebrada e fica o fundo neutro. Inclui a que falhou antes da hidratação (SSR).
  const cover = useBrokenImage(store.coverImageUrl);
  const logo = useBrokenImage(store.logoUrl);
  const hasCover = Boolean(store.coverImageUrl) && !cover.failed;
  const hasLogo = Boolean(store.logoUrl) && !logo.failed;
  const whatsappLink = store.whatsapp ? `https://wa.me/${store.whatsapp}` : null;
  const minOrderCents = store.minOrderCents;

  return (
    <div>
      {/* Spec 09 §2.1: sem capa (ou capa quebrada) vira um bloco liso mais baixo, sem ícone. */}
      <div className={`loja__cover${hasCover ? "" : " loja__cover--empty"}`}>
        {hasCover && <img ref={cover.ref} src={store.coverImageUrl as string} alt="" onError={cover.onError} />}
      </div>

      <div className="loja__card">
        <div className="loja__card-top">
          <div className="loja__identity">
            {hasLogo ? (
              <div className="loja__logo">
                {/* alt vazio: o nome da loja já está no título ao lado (revisão da Da Vinci, N1) */}
                <img ref={logo.ref} src={store.logoUrl as string} alt="" onError={logo.onError} />
              </div>
            ) : (
              // Iniciais (spec 09 §2.2): decorativo, o nome da loja vem logo ao lado.
              <div className="loja__logo loja__logo--initials" aria-hidden="true">
                {storeInitials(store.name)}
              </div>
            )}
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
            <a href={whatsappLink} target="_blank" rel="noreferrer" className="loja__whatsapp" title="Falar no WhatsApp" aria-label="Falar com a loja no WhatsApp (abre em outra aba)">
              <ChatIcon />
            </a>
          )}
        </div>

        {store.openingHours && (
          <>
            {/* Spec 09 §2.4: a linha inteira é o botão. Até o B5 existir o servidor não sabe se está
                aberto, então não afirmamos "aberto agora": só o texto cadastrado pela loja. */}
            <button
              type="button"
              className="loja__hours-row"
              aria-expanded={showHours}
              aria-controls="loja-horarios"
              onClick={() => setShowHours((v) => !v)}
            >
              <ClockIcon />
              <span className="loja__hours-label">Horário de funcionamento</span>
              <span className={`loja__hours-chevron${showHours ? " loja__hours-chevron--open" : ""}`}>
                <ChevronIcon />
              </span>
            </button>
            <p id="loja-horarios" className="loja__hours" hidden={!showHours}>
              {store.openingHours}
            </p>
          </>
        )}

        <button type="button" onClick={onOpenSearch} className="loja__search">
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
