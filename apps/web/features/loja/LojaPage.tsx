"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Menu, Product } from "@/core/domain/storefront";
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
import { SearchScreen } from "./components/SearchScreen";
import { StoreHeader } from "./components/StoreHeader";
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
import { isCompactCategory, quickAddMode } from "./storeInfo";
import { lojaThemeStyle } from "./theme";
import "./loja.css";
import "./motion.css";

// useLayoutEffect avisa no servidor (SSR); lá o efeito não precisa rodar.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Orquestra as telas da loja pública: decide qual aparece e liga carrinho e pedido.
// Desenho, regras do carrinho, ciclo do pedido e HTTP vivem em arquivos próprios.
export function LojaPage({ slug, initialMenu }: { slug: string; initialMenu?: Menu }) {
  const { menu, notFound, refresh } = useMenu(slug, initialMenu);
  const history = useOrderHistory(slug);
  const order = useOrderFlow(slug, history.record);

  const [tab, setTab] = useState<NavTab>("itens");
  const [showCategories, setShowCategories] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // De onde o detalhe abriu: ao fechar, a rolagem e o foco voltam para lá (WEB-22, F2).
  const returnPoint = useRef<ReturnPoint | null>(null);

  const productsById = useMemo(
    () => new Map(menu?.categories.flatMap((c) => c.products.map((p) => [p.id, p] as const)) ?? []),
    [menu],
  );
  const cart = useCart(productsById);

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
    if (order.errorCode === "STORE_CLOSED") refresh();
  }, [order.errorCode, refresh]);

  const rootStyle = lojaThemeStyle(menu?.store.primaryColor);

  function openProduct(product: Product) {
    returnPoint.current = { productId: product.id, scrollY: window.scrollY };
    setDetailProduct(product);
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
    if (quickAddMode(product) === "detail") return openProduct(product);
    cart.add(product.id, 1, [], "");
  }

  function scrollToCategory(id: string) {
    setTab("itens");
    setShowCategories(false);
    setSelectedCategoryId(id);
    setPinnedId(id);
    setTimeout(() => document.getElementById(`categoria-${id}`)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }), 0);
  }

  async function submitOrder(form: CheckoutForm, totals: CheckoutTotals) {
    const summary = buildOrderSummary(form, cart.cart, productsById, totals.totalCents);
    const placed = await order.submit(form, cart.cart, totals.totalCents, summary);
    if (!placed) return;
    cart.clear();
    setCheckoutOpen(false);
  }

  function renderScreen() {
    if (notFound) return <main className="loja__message">Loja não encontrada.</main>;
    if (!menu) return <main className="loja__message">Carregando...</main>;

    const { store, categories } = menu;
    // Categoria sem produto não aparece para o cliente (spec 09 §6).
    const visibleCategories = categories.filter((category) => category.products.length > 0);
    const hasProducts = visibleCategories.length > 0;
    // Destaque do chip: a seção que está na tela (scrollspy); antes da 1ª leitura, a escolhida ou a primeira.
    const activeCategoryId = pinnedId && atEnd ? pinnedId : spyId ? spyId.replace("categoria-", "") : (selectedCategoryId ?? visibleCategories[0]?.id ?? null);
    const identity = { name: store.name, logoUrl: store.logoUrl, initials: storeInitials(store.name) };
    const closed = !store.acceptingOrders;

    if (order.placed) {
      return (
        <OrderResultScreen
          code={order.placed.code}
          cancelled={order.placed.cancelled}
          pixData={order.placed.pixData}
          paymentConfirmed={order.placed.paymentConfirmed}
          paymentFailedMessage={order.placed.paymentFailedMessage}
          cancelError={order.placed.cancelError}
          summary={order.placed.summary}
          whatsapp={store.whatsapp}
          onCancel={order.cancel}
          onBack={order.back}
        />
      );
    }

    if (detailProduct) {
      return (
        <ProductDetailScreen
          product={detailProduct}
          closed={closed}
          logoUrl={store.logoUrl}
          onClose={() => setDetailProduct(null)}
          onConfirm={({ quantity, additionalIds, notes }) => {
            cart.add(detailProduct.id, quantity, additionalIds, notes);
            setDetailProduct(null);
          }}
        />
      );
    }

    if (tab === "pesquisa") {
      return (
        <SearchScreen
          categories={categories}
          closed={closed}
          quantityByProduct={cart.quantityByProduct}
          onClose={() => setTab("itens")}
          onOpenProduct={openProduct}
          onQuickAdd={quickAdd}
          onRemoveOne={(product) => cart.removeOne(product.id)}
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
            <OrdersScreen orders={history.orders} storeName={store.name} />
          </div>
        ) : (
          <>
            <StickyBar visible={identityGone} identity={identity} onOpenSearch={() => setTab("pesquisa")} />
            <StoreHeader
              store={store}
              onOpenSearch={() => setTab("pesquisa")}
              onViewAllCategories={() => setShowCategories(true)}
              showCategoriesHead={visibleCategories.length > 1}
            />
            <div ref={setIdentityMarker} className="loja__marker" aria-hidden="true" />
            {/* Filha da página inteira (não da folha da identidade): é o que a deixa fixa até o fim da rolagem. */}
            <CategoryChips
              categories={visibleCategories}
              activeCategoryId={activeCategoryId}
              stuck={identityGone}
              identity={identity}
              onSelect={scrollToCategory}
              onOpenSearch={() => setTab("pesquisa")}
            />

            {/* Destino do link "Ir para o cardápio" (primeiro foco da página). */}
            <div className="loja__content" id="cardapio-conteudo" tabIndex={-1}>
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
              {visibleCategories.map((category) => {
                const compact = isCompactCategory(category);
                return (
                  <section key={category.id} id={"categoria-" + category.id} className="loja__section">
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

        <BottomNav active={tab} onSelect={setTab} />

        {cartOpen && (
          <CartDrawer
            cart={cart.cart}
            productsById={productsById}
            lineTotalCents={cart.lineTotalCents}
            totalCents={cart.totalCents}
            minOrderCents={store.minOrderCents}
            closed={closed}
            totalLabel={store.deliveryFeeCents > 0 ? "Subtotal" : "Total"}
            onChangeQuantity={cart.changeQuantity}
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
            subtotalCents={cart.totalCents}
            closed={closed}
            submitting={order.submitting}
            error={order.error}
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
