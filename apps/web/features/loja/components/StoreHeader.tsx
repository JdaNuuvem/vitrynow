import { useState, type ReactNode } from "react";
import { ThemeControls } from "@/shared/design/ThemeControls";
import { useBrokenImage } from "../hooks/useBrokenImage";
import type { StoreInfo } from "@/core/domain/storefront";
import { storeInitials } from "@/lib/storeInitials";
import { STORE_CLOSED_MESSAGE } from "../checkoutForm";
import { ChatIcon, ClockIcon, CoinIcon, FiltersIcon, InfoIcon, PinIcon, SearchIcon } from "../icons";
import { conditionsLine, isStoreAcceptingOrders, prepTimesLine } from "../storeInfo";

// Cabeçalho do cardápio: fotografia da loja, superfície branca e identidade legível. Só mostra "quem é a loja" e dá entrada à busca e às
// categorias; os chips e o carrinho moram fora (a barra de categorias fica fixa e precisa ser filha da página inteira).
export function StoreHeader({
  store,
  onOpenSearch,
  onViewAllCategories,
  showCategoriesHead,
  searchField,
  tableLabel,
  qrDisabled = false,
  preview = false,
}: {
  store: StoreInfo;
  onOpenSearch: () => void;
  onViewAllCategories: () => void;
  // Só há o que escolher com 2 categorias ou mais (mesma regra dos chips).
  showCategoriesHead: boolean;
  searchField?: ReactNode;
  tableLabel?: string;
  qrDisabled?: boolean;
  preview?: boolean;
}) {
  const [showInfo, setShowInfo] = useState(false);
  // O bloco de cor e o monograma mantêm a identidade quando uma imagem falha, inclusive antes da hidratação.
  const cover = useBrokenImage(store.coverImageUrl);
  const logo = useBrokenImage(store.logoUrl);
  const hasCover = Boolean(store.coverImageUrl) && !cover.failed;
  const hasLogo = Boolean(store.logoUrl) && !logo.failed;
  const whatsappLink = store.whatsapp ? `https://wa.me/${store.whatsapp}` : null;
  const conditions = tableLabel
    ? conditionsLine({ ...store, deliveryEnabled: false, pickupEnabled: false })
    : conditionsLine(store);
  const open = !qrDisabled && isStoreAcceptingOrders(store);
  const hours = store.acceptingOrders ? store.hours : null;
  const openStatus = hours?.status === "ABERTO" && hours.closesAt ? hours.message : "Recebendo pedidos";
  const closedStatus = qrDisabled ? "Pedidos com o atendente" : hours?.status === "PAUSADO" ? "Pedidos pausados" : "Fechado agora";
  const closedMessage = qrDisabled ? "Para fazer seu pedido, chame o atendente." : hours && hours.status !== "ABERTO" ? hours.message : `${STORE_CLOSED_MESSAGE}.`;
  const prepTimes = open && !tableLabel ? prepTimesLine(store) : "";
  const Title = preview ? "strong" : "h1";

  return (
    <header className="loja__store-header">
      <section className="loja__store-summary" aria-label="Sobre a loja">
        <div className="loja__store-summary-row">
          {hasLogo ? (
            <div className="loja__logo">
              <img ref={logo.ref} src={store.logoUrl as string} alt="" width={40} height={40} decoding="async" onError={logo.onError} />
            </div>
          ) : (
            <span className="loja__logo loja__logo--initials" aria-hidden="true">{storeInitials(store.name)}</span>
          )}
          <div className="loja__summary-title">
            {tableLabel && <p className="mesa-cardapio__label">{tableLabel}</p>}
            <Title className="loja__name">{store.name}</Title>
            <span className={`loja__summary-state${open ? "" : " loja__summary-state--closed"}`}>
              <span className={`loja__dot${open ? "" : " loja__dot--closed"}`} aria-hidden="true" />
              {open ? openStatus : closedStatus}
            </span>
          </div>
          {!preview && (store.address || store.openingHours || conditions) && (
            <button
              className="loja__summary-action"
              type="button"
              aria-label={store.openingHours ? "Ver horários e informações da loja" : "Informações da loja"}
              aria-expanded={showInfo}
              aria-controls="loja-horarios"
              onClick={() => setShowInfo((expanded) => !expanded)}
            >
              <InfoIcon />
            </button>
          )}
          {!preview && <ThemeControls compact />}
          {!preview && whatsappLink && (
            <a href={whatsappLink} target="_blank" rel="noreferrer" className="loja__summary-action" aria-label="Falar com a loja no WhatsApp (abre em outra aba)">
              <ChatIcon />
            </a>
          )}
        </div>
        {!open && <p className="loja__closed-notice" role="status">{closedMessage}</p>}
        {prepTimes && <p className="loja__prep-times"><ClockIcon /><span>{prepTimes}</span></p>}
        {!preview && <div className="loja__store-details" id="loja-horarios" hidden={!showInfo}>
          {store.address && <p><PinIcon /><span>{store.address}</span></p>}
          {conditions && <p><CoinIcon /><span>{conditions}</span></p>}
          {store.openingHours && <p><ClockIcon /><span>{store.openingHours}</span></p>}
        </div>}
      </section>
      <div className={`loja__menu-hero${hasCover ? " loja__menu-hero--with-cover" : ""}`}>
        <div className={`loja__cover${hasCover ? "" : " loja__cover--empty"}${store.coverImageUrl ? "" : " loja__cover--compact"}`}>
          {hasCover && <img ref={cover.ref} src={store.coverImageUrl as string} alt="" width={1408} height={768} loading="eager" onError={cover.onError} />}
        </div>
        <div className="loja__hero-actions">
          {searchField ?? (preview ? <p className="loja__search">Pesquisar no cardápio</p> : <button type="button" onClick={onOpenSearch} className="loja__search">
            <span className="loja__search-icon" aria-hidden="true"><SearchIcon size="md" /></span>
            Pesquisar no cardápio
          </button>)}
          {!preview && showCategoriesHead && (
            <div className="loja__category-picker">
              <h2 className="sr-only">Categorias</h2>
              <button type="button" onClick={onViewAllCategories} aria-label="Ver todas as categorias" title="Ver todas as categorias">
                <FiltersIcon />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
