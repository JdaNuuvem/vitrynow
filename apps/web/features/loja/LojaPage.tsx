"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Menu, Product } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import { BottomNav, type NavTab } from "./components/BottomNav";
import { CartDrawer } from "./components/CartDrawer";
import { CategoriesScreen } from "./components/CategoriesScreen";
import { CategoryChips, CategorySectionHeading } from "./components/CategoryNav";
import { CheckoutDrawer } from "./components/CheckoutDrawer";
import { OrderResultScreen } from "./components/OrderResultScreen";
import { OrdersScreen } from "./components/OrdersScreen";
import { ProductDetailScreen } from "./components/ProductDetailScreen";
import { ProductListItem } from "./components/ProductListItem";
import { SearchScreen } from "./components/SearchScreen";
import { StoreHeader } from "./components/StoreHeader";
import { STORE_CLOSED_MESSAGE, buildOrderSummary, type CheckoutForm, type CheckoutTotals } from "./checkoutForm";
import { InfoIcon } from "./icons";
import { useCart } from "./hooks/useCart";
import { useMenu } from "./hooks/useMenu";
import { useOrderFlow } from "./hooks/useOrderFlow";
import { useOrderHistory } from "./hooks/useOrderHistory";
import { scrollBehavior } from "@/lib/motion";
import "./loja.css";

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

  const productsById = useMemo(
    () => new Map(menu?.categories.flatMap((c) => c.products.map((p) => [p.id, p] as const)) ?? []),
    [menu],
  );
  const cart = useCart(productsById);

  // Se o servidor recusou por loja fechada, rebusca o cardápio: o banner e o bloqueio passam a vir do estado real.
  useEffect(() => {
    if (order.errorCode === "STORE_CLOSED") refresh();
  }, [order.errorCode, refresh]);

  const rootStyle = menu?.store.primaryColor ? ({ "--loja-accent": menu.store.primaryColor } as CSSProperties) : undefined;

  function quickAdd(product: Product) {
    if (product.additionals.length > 0) return setDetailProduct(product);
    cart.add(product.id, 1, [], "");
  }

  function scrollToCategory(id: string) {
    setTab("itens");
    setShowCategories(false);
    setSelectedCategoryId(id);
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
    const activeCategoryId = selectedCategoryId ?? categories[0]?.id ?? null;
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
          onOpenProduct={setDetailProduct}
          onQuickAdd={quickAdd}
        />
      );
    }

    if (showCategories) {
      return <CategoriesScreen categories={visibleCategories} onClose={() => setShowCategories(false)} onSelect={scrollToCategory} />;
    }

    return (
      <main className="loja__page">
        {tab === "pedidos" ? (
          <OrdersScreen orders={history.orders} storeName={store.name} />
        ) : (
          <>
            <StoreHeader store={store} onOpenSearch={() => setTab("pesquisa")}>
              <CategoryChips
                categories={visibleCategories}
                activeCategoryId={activeCategoryId}
                onSelect={scrollToCategory}
                onViewAll={() => setShowCategories(true)}
              />
            </StoreHeader>

            {/* Destino do link "Ir para o cardápio" (primeiro foco da página). */}
            <div className="loja__content" id="cardapio-conteudo" tabIndex={-1}>
              {closed && (
                <div className="loja__closed" role="status">
                  <InfoIcon />
                  <span>{STORE_CLOSED_MESSAGE}.</span>
                </div>
              )}
              {!hasProducts && (
                <div className="loja__empty-menu" role="status">
                  <p>Este cardápio ainda não tem produtos.</p>
                  {store.whatsapp && (
                    <a href={`https://wa.me/${store.whatsapp}`} target="_blank" rel="noreferrer" className="loja__empty-menu-link">
                      Falar com a loja
                    </a>
                  )}
                </div>
              )}
              {visibleCategories.map((category) => (
                <section key={category.id} id={`categoria-${category.id}`} className="loja__section">
                  <CategorySectionHeading category={category} />
                  <div className="loja__list">
                    {category.products.map((product) => (
                      <ProductListItem
                        key={product.id}
                        closed={closed}
                        product={product}
                        quantityInCart={cart.quantityByProduct[product.id] ?? 0}
                        onOpen={setDetailProduct}
                        onQuickAdd={quickAdd}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        {cart.itemCount > 0 && !checkoutOpen && (
          <button onClick={() => setCartOpen(true)} className="loja__cart-bar">
            <span>Ver carrinho ({cart.itemCount})</span>
            <span className="loja__cart-bar-total">{formatCents(cart.totalCents)}</span>
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
    <div className="loja" style={rootStyle} data-brand={menu?.store.primaryColor ? "" : undefined}>
      <a href="#cardapio-conteudo" className="loja__skip">
        Ir para o cardápio
      </a>
      {renderScreen()}
    </div>
  );
}
