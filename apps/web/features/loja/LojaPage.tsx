"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Menu, Product } from "@/core/domain/storefront";
import { useStorefrontServices } from "@/core/services/StorefrontServices";
import { formatCents } from "@/shared/format/money";
import { BottomNav, type NavTab } from "./components/BottomNav";
import { CartDrawer } from "./components/CartDrawer";
import { CategoriesScreen } from "./components/CategoriesScreen";
import { CategoryChips, CategorySectionHeading, StickyBar } from "./components/CategoryNav";
import { CheckoutDrawer } from "./components/CheckoutDrawer";
import { OrderResultScreen } from "./components/OrderResultScreen";
import { OrdersScreen } from "./components/OrdersScreen";
import { ProductDetailScreen } from "./components/ProductDetailScreen";
import { ProductListItem } from "./components/ProductListItem";
import { CloseIcon, SearchIcon } from "./icons";
import { SearchResults } from "./components/SearchScreen";
import { MenuBanner } from "./components/MenuBanner";
import { MenuSkeleton } from "./components/Skeleton";
import { StoreHeader } from "./components/StoreHeader";
import { bannerForStore } from "./banners";
import { cartLineMustBeReviewed, quoteCart } from "./cartPricing";
import { orderNeedsUpdatedCatalog } from "./productOptions";
import { buildOrderSummary, type CheckoutForm, type CheckoutTotals } from "./checkoutForm";
import { restoreReturnPoint, type ReturnPoint } from "./focusReturn";
import { useCart } from "./hooks/useCart";
import { useInView } from "./hooks/useInView";
import { useScrolledPast } from "./hooks/useScrolledPast";
import { useScrollSpy } from "./hooks/useScrollSpy";
import { useMenu } from "./hooks/useMenu";
import { useOrderFlow } from "./hooks/useOrderFlow";
import { useOrderHistory } from "./hooks/useOrderHistory";
import { scrollBehavior } from "@/lib/motion";
import { storeInitials } from "@/lib/storeInitials";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { lojaTitleFont } from "./fonts";
import { activeCategoryId as activeCategory, isCompactCategory, isStoreAcceptingOrders, quickAddMode } from "./storeInfo";
import { lojaThemeStyle } from "./theme";
import "./loja.css";
import "./cardapio.css";
import "./motion.css";

// useLayoutEffect avisa no servidor (SSR); lá o efeito não precisa rodar.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Orquestra as telas da loja pública: decide qual aparece e liga carrinho e pedido.
// Desenho, regras do carrinho, ciclo do pedido e HTTP vivem em arquivos próprios.
export function LojaPage({ slug, initialMenu }: { slug: string; initialMenu?: Menu }) {
  const { storefront } = useStorefrontServices();
  const { menu, notFound, error: menuError, loading: menuLoading, refresh, markClosedByServer } = useMenu(slug, initialMenu);
  const history = useOrderHistory(slug);
  const order = useOrderFlow(slug, history.record);

  const [tab, setTab] = useState<NavTab>("itens");
  const [searchTerm, setSearchTerm] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // De onde o detalhe abriu: ao fechar, a rolagem e o foco voltam para lá (WEB-22, F2).
  const returnPoint = useRef<ReturnPoint | null>(null);

  const productsById = useMemo(
    () => new Map(menu?.categories.flatMap((c) => c.products.map((p) => [p.id, p] as const)) ?? []),
    [menu],
  );
  const cart = useCart(productsById);
  const unavailableInCart = cart.cart.some((line) => cartLineMustBeReviewed(line, productsById.get(line.productId)));

  useEffect(() => {
    if (checkoutOpen && unavailableInCart) {
      setCheckoutOpen(false);
      setCartOpen(true);
    }
  }, [checkoutOpen, unavailableInCart]);

  // Barra de categorias fixa e destaque da categoria na tela (spec 12 §2.1). Tudo por IntersectionObserver: nenhum
  // ouvinte de scroll. O marcador fica logo abaixo da identidade; quando ela sai de vista, as barras fixas aparecem.
  const [identityMarker, setIdentityMarker] = useState<Element | null>(null);
  const identityGone = useScrolledPast(identityMarker);
  const wide = useMediaQuery("(min-width: 768px)");
  const sectionIds = useMemo(() => (menu?.categories ?? []).filter((category) => category.products.length > 0).map((category) => "categoria-" + category.id), [menu]);
  // Faixa de leitura: abaixo das barras fixas (56 + 56 no celular; uma linha só de 64 em tela larga).
  // A tela do cardápio só existe quando nada (detalhe, busca, categorias, resultado do pedido) está por cima.
  const itemsScreenShown = Boolean(menu) && !order.placed && !detailProduct && tab === "itens" && !showCategories;
  // Fim da página: as últimas categorias são curtas e não chegam à linha de leitura. Se a pessoa tocou num chip e a página
  // parou no fim, o chip tocado continua destacado (o pino cai assim que ela sai do fim).
  const [endMarker, setEndMarker] = useState<Element | null>(null);
  const atEnd = useInView(endMarker);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  useEffect(() => {
    if (!atEnd) setPinnedId(null);
  }, [atEnd]);
  const spyId = useScrollSpy(sectionIds, { topOffsetPx: wide ? 72 : 120, enabled: itemsScreenShown });

  // Se o servidor recusou por loja fechada, rebusca o cardápio: o banner e o bloqueio passam a vir do estado real.
  useEffect(() => {
    if (orderNeedsUpdatedCatalog(order.errorCode)) {
      void refresh();
      return;
    }
    if (order.errorCode !== "STORE_CLOSED" && order.errorCode !== "SUBSCRIPTION_INACTIVE") return;
    markClosedByServer();
    void refresh();
  }, [order.errorCode, refresh, markClosedByServer]);

  const rootStyle = lojaThemeStyle(menu?.store.primaryColor);

  function openProduct(product: Product, bannerId?: string, featured?: boolean) {
    returnPoint.current = { productId: product.id, scrollY: window.scrollY, bannerId, featured };
    setDetailProduct(product);
  }

  function closeDetail() {
    setDetailProduct(null);
    if (editingLine !== null) setCartOpen(true);
    setEditingLine(null);
  }

  useIsomorphicLayoutEffect(() => {
    if (detailProduct) {
      window.scrollTo(0, 0); // o detalhe começa no topo (sem `return`: o valor devolvido por um efeito vira função de limpeza)
      return;
    }
    const point = returnPoint.current;
    returnPoint.current = null;
    if (point) restoreReturnPoint(document, point, (y) => window.scrollTo(0, y));
  }, [detailProduct]);

  // "+" do cartão (spec 12 §3): sem adicionais ou só com adicionais OPCIONAIS adiciona 1 unidade simples; só grupo
  // obrigatório (quando existir, API-15) abre o detalhe. O servidor valida do mesmo jeito (RN-B8-01).
  function quickAdd(product: Product) {
    if (product.soldOut || product.unavailableByOptions || !menu || !isStoreAcceptingOrders(menu.store)) return;
    if (quickAddMode(product) === "detail") return openProduct(product);
    cart.add(product.id, 1, [], "");
  }

  function openSearch() {
    setTab("pesquisa");
    if (tab !== "pesquisa") setSearchTerm("");
    searchInput.current?.focus();
  }

  function closeSearch() {
    setTab("itens");
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".loja__menu-hero .loja__search")?.focus());
  }

  function scrollToCategory(id: string, focusSection = false) {
    setTab("itens");
    setShowCategories(false);
    setPinnedId(id);
    setTimeout(() => {
      const section = document.getElementById(`categoria-${id}`);
      section?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
      if (focusSection) section?.focus({ preventScroll: true });
    }, 0);
  }

  async function submitOrder(form: CheckoutForm, totals: CheckoutTotals) {
    if (unavailableInCart) {
      setCheckoutOpen(false);
      setCartOpen(true);
      return;
    }
    const summary = buildOrderSummary(form, cart.cart, productsById, totals.totalCents);
    const placed = await order.submit(form, quoteCart(cart.cart, productsById), totals.totalCents, summary);
    if (!placed) return;
    cart.clear();
    setCheckoutOpen(false);
  }

  function renderScreen() {
    if (notFound) return <main className="loja__message" id="cardapio-conteudo" tabIndex={-1}>Loja não encontrada.</main>;
    if (!menu) return (
      <main className="loja__loading" id="cardapio-conteudo" tabIndex={-1}>
        {menuError ? (
          <div className="loja__load-error">
            <h1>Cardápio indisponível</h1>
            <p role="alert">{menuError}</p>
            <button type="button" className="loja__retry" onClick={() => { void refresh(); }} disabled={menuLoading}>
              Tentar novamente
            </button>
          </div>
        ) : <MenuSkeleton />}
      </main>
    );

    const { store, categories } = menu;
    const banner = store.campaign === undefined ? bannerForStore(slug) : store.campaign ?? undefined;
    // Categoria sem produto não aparece para o cliente (spec 09 §6).
    const visibleCategories = categories.filter((category) => category.products.length > 0);
    const featuredProducts = visibleCategories.flatMap((category) =>
      category.products.filter((product) => product.featured).map((product) => ({ product, category })),
    );
    const hasProducts = visibleCategories.length > 0;
    // Destaque do chip (regras em activeCategoryId): leitura da rolagem, o chip tocado no fim e a última categoria no fim.
    const activeCategoryId = activeCategory({ ids: visibleCategories.map((category) => category.id), spy: spyId ? spyId.replace("categoria-", "") : null, pinned: pinnedId, atEnd });
    const identity = { name: store.name, logoUrl: store.logoUrl, initials: storeInitials(store.name) };
    const closed = !isStoreAcceptingOrders(store);

    if (order.placed) {
      const receipt = history.orders[0];
      const readTracking = order.placed.resume === "none" && receipt?.code === order.placed.code ? order.trackingFor(receipt) : undefined;
      return (
        <OrderResultScreen
          readTracking={readTracking}
          code={order.placed.code}
          cancelled={order.placed.cancelled}
          pixData={order.placed.pixData}
          paymentConfirmed={order.placed.paymentConfirmed}
          paymentFailedMessage={order.placed.paymentFailedMessage}
          cancelError={order.placed.cancelError}
          trackingUnavailable={order.placed.trackingUnavailable}
          resume={order.placed.resume}
          pixExpiresAt={order.placed.pixExpiresAt}
          storeName={store.name}
          storeSlug={slug}
          storeCoverUrl={store.coverImageUrl}
          totalCents={order.placed.totalCents}
          summary={order.placed.summary}
          whatsapp={store.whatsapp}
          onCancel={order.cancel}
          onBack={order.back}
        />
      );
    }

    if (detailProduct) {
      const currentProduct = productsById.get(detailProduct.id);
      return (
        <ProductDetailScreen
          product={currentProduct ?? { ...detailProduct, soldOut: true }}
          initialChoice={editingLine === null ? undefined : cart.cart[editingLine]}
          closed={closed}
          logoUrl={store.logoUrl}
          onClose={closeDetail}
          onConfirm={(choice) => {
            if (!currentProduct || currentProduct.soldOut || closed) return;
            if (editingLine === null) cart.add(currentProduct.id, choice.quantity, choice.additionalIds, choice.notes, choice.optionSelections);
            else cart.edit(editingLine, choice);
            closeDetail();
          }}
        />
      );
    }

    if (showCategories) {
      return <CategoriesScreen categories={visibleCategories} onClose={() => setShowCategories(false)} onSelect={scrollToCategory} />;
    }

    return (
      <main className="loja__page">
        {tab === "pedidos" ? (
          <div className="loja__column">
            <OrdersScreen orders={history.orders} storeName={store.name} whatsapp={store.whatsapp} pendingPix={order.pendingPix} trackingFor={order.trackingFor} />
          </div>
        ) : (
          <>
            <StickyBar visible={identityGone} identity={identity} onOpenSearch={openSearch} />
            <div className={tab === "itens" && banner && store.coverImageUrl ? "loja__intro--campaign" : undefined}>
              <StoreHeader
                store={store}
                onOpenSearch={openSearch}
                onViewAllCategories={() => setShowCategories(true)}
                showCategoriesHead={visibleCategories.length > 1}
                searchField={tab === "pesquisa" ? (
                  <div className="loja__search loja__search--editing">
                    <SearchIcon size="md" />
                    <input autoFocus ref={searchInput} value={searchTerm} aria-label="Pesquisar no cardápio" placeholder="Pesquisar no cardápio"
                      onChange={(event) => setSearchTerm(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") closeSearch(); }} />
                    <button type="button" aria-label="Fechar a busca e voltar ao cardápio" onClick={closeSearch}><CloseIcon /></button>
                  </div>
                ) : undefined}
              />
              <MenuBanner
                banner={tab === "itens" ? banner : undefined}
                categories={categories}
                onSelectCategory={(id) => scrollToCategory(id, true)}
                onOpenProduct={(product) => openProduct(product, banner?.id)}
              />
            </div>
            <div ref={setIdentityMarker} className="loja__marker" aria-hidden="true" />
            {/* Filha da página inteira (não da folha da identidade): é o que a deixa fixa até o fim da rolagem. */}
            <CategoryChips
              categories={visibleCategories}
              activeCategoryId={featuredProducts.length && !spyId && !pinnedId ? null : activeCategoryId}
              stuck={identityGone}
              identity={identity}
              onSelect={scrollToCategory}
              onSelectAll={featuredProducts.length ? () => {
                setTab("itens");
                setPinnedId(null);
                document.getElementById("cardapio-conteudo")?.scrollIntoView({ behavior: scrollBehavior() });
              } : undefined}
              onOpenSearch={openSearch}
            />

            {/* Destino do link "Ir para o cardápio" (primeiro foco da página). */}
            <div className="loja__content" id="cardapio-conteudo" tabIndex={-1}>
              {tab === "pesquisa" ? (
                <SearchResults categories={visibleCategories} term={searchTerm} closed={closed}
                  quantityByProduct={cart.quantityByProduct} onOpenProduct={openProduct} onQuickAdd={quickAdd}
                  onRemoveOne={(product) => cart.removeOne(product.id)}
                  onClear={() => { setSearchTerm(""); searchInput.current?.focus(); }} />
              ) : (
                <>
                  {!hasProducts && (
                    <div className="loja__empty-menu" role="status">
                      <p>Este cardápio ainda não tem produtos.</p>
                      {store.whatsapp && (
                        <a href={"https://wa.me/" + store.whatsapp} target="_blank" rel="noreferrer" className="loja__empty-menu-link">
                          Falar com a loja
                        </a>
                      )}
                    </div>
                  )}
                  {featuredProducts.length > 0 && (
                    <section className="loja__section" aria-labelledby="loja-destaques">
                      <h2 className="loja__section-title" id="loja-destaques">Destaques da casa</h2>
                      <div className="loja__list loja__list--featured">
                        {featuredProducts.map(({ product, category }) => (
                          <ProductListItem
                            key={product.id}
                            product={product}
                            photoCard
                            categoryIcon={category.icon}
                            closed={closed}
                            quantityInCart={cart.quantityByProduct[product.id] ?? 0}
                            onOpen={(item) => openProduct(item, undefined, true)}
                            onQuickAdd={quickAdd}
                            onRemoveOne={(item) => cart.removeOne(item.id)}
                          />
                        ))}
                      </div>
                    </section>
                  )}
                  {visibleCategories.map((category) => {
                    const compact = isCompactCategory(category);
                    return (
                      <section key={category.id} id={"categoria-" + category.id} className="loja__section" tabIndex={-1}>
                        <CategorySectionHeading category={category} />
                        <div className={"loja__list" + (compact ? " loja__list--compact" : "")}>
                          {category.products.map((product) => (
                            <ProductListItem
                              key={product.id}
                              closed={closed}
                              compact={compact}
                              categoryIcon={category.icon}
                              product={product}
                              quantityInCart={cart.quantityByProduct[product.id] ?? 0}
                              onOpen={openProduct}
                              onQuickAdd={quickAdd}
                              onRemoveOne={(item) => cart.removeOne(item.id)}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </>
              )}
            </div>
            <div ref={setEndMarker} className="loja__end" aria-hidden="true" />
          </>
        )}

        {cart.itemCount > 0 && !checkoutOpen && (
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="loja__cart-bar"
            aria-label={"Ver carrinho: " + cart.itemCount + (cart.itemCount === 1 ? " item, " : " itens, ") + formatCents(cart.totalCents)}
          >
            <span className="loja__cart-bar-left">
              <span className="loja__cart-bar-count" aria-hidden="true">
                {cart.itemCount}
              </span>
              <span aria-hidden="true">Ver carrinho</span>
            </span>
            <span className="loja__cart-bar-total" aria-hidden="true">
              {formatCents(cart.totalCents)}
            </span>
          </button>
        )}

        <BottomNav active={tab} onSelect={(next) => next === "pesquisa" ? openSearch() : setTab(next)} />

        {cartOpen && (
          <CartDrawer
            cart={cart.cart}
            productsById={productsById}
            lineTotalCents={cart.lineTotalCents}
            totalCents={cart.totalCents}
            minOrderCents={store.minOrderCents}
            closed={closed}
            totalLabel={store.deliveryEnabled ? "Subtotal" : "Total"}
            onChangeQuantity={cart.changeQuantity}
            onEdit={(index, product) => {
              setEditingLine(index);
              setCartOpen(false);
              setDetailProduct(product);
            }}
            onClose={() => setCartOpen(false)}
            onContinue={() => {
              setCartOpen(false);
              setCheckoutOpen(true);
            }}
          />
        )}

        {checkoutOpen && (
          <CheckoutDrawer
            store={store}
            gateway={storefront}
            pixAvailable={store.payment?.pixAvailable}
            subtotalCents={cart.totalCents}
            closed={closed}
            submitting={order.submitting || (order.errorCode === "ITEM_PRICE_CHANGED" && menuLoading)}
            error={order.error}
            errorCode={order.errorCode}
            errorDetails={order.errorDetails}
            onClose={() => setCheckoutOpen(false)}
            onSubmit={submitOrder}
          />
        )}
      </main>
    );
  }

  return (
    <div className={"loja " + lojaTitleFont.variable} style={rootStyle}>
      <a href="#cardapio-conteudo" className="loja__skip">
        Ir para o cardápio
      </a>
      {renderScreen()}
    </div>
  );
}
