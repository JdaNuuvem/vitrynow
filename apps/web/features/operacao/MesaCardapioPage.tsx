"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Menu, OrderOptionSnapshot, Product } from "@/core/domain/storefront";
import { statusLabel } from "@/core/domain/orderLabels";
import { CartDrawer } from "@/features/loja/components/CartDrawer";
import { CategorySectionHeading } from "@/features/loja/components/CategoryNav";
import { ProductDetailScreen } from "@/features/loja/components/ProductDetailScreen";
import { ProductListItem } from "@/features/loja/components/ProductListItem";
import { SearchResults } from "@/features/loja/components/SearchScreen";
import { Sheet } from "@/features/loja/components/Sheet";
import { MenuSkeleton } from "@/features/loja/components/Skeleton";
import { StoreHeader } from "@/features/loja/components/StoreHeader";
import { cartLineMustBeReviewed, isBelowMinOrder, quoteCart } from "@/features/loja/cartPricing";
import { restoreReturnPoint, type ReturnPoint } from "@/features/loja/focusReturn";
import { lojaTitleFont } from "@/features/loja/fonts";
import { useCart } from "@/features/loja/hooks/useCart";
import { CloseIcon, SearchIcon } from "@/features/loja/icons";
import { orderNeedsUpdatedCatalog } from "@/features/loja/productOptions";
import { isCompactCategory, isStoreAcceptingOrders, quickAddMode } from "@/features/loja/storeInfo";
import { lojaThemeStyle } from "@/features/loja/theme";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { operationRequest } from "./storeOperations";
import "@/features/loja/loja.css";
import "@/features/loja/cardapio.css";
import "@/features/loja/purchase.css";
import "./mesa-cardapio.css";

type TableMenu = Menu & {
  table: { label: string };
  qr: { orderingEnabled: boolean; needsApproval: boolean };
};
type TableOrder = {
  id: string;
  code: string;
  status: string;
  totalCents: number;
  items: {
    productName: string;
    quantity: number;
    notes?: string | null;
    additionals?: { name: string }[];
    options?: OrderOptionSnapshot[];
  }[];
};

function newDeviceToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "mcd_" + btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function TableHistory({ orders, loading }: { orders: TableOrder[] | null; loading: boolean }) {
  if (orders === null) return loading ? <p role="status">Consultando pedidos…</p> : null;
  if (orders.length === 0) return <p>Nenhum pedido registrado neste aparelho.</p>;
  return (
    <ul className="mesa-cardapio__history" aria-label="Pedidos deste aparelho">
      {orders.map((order) => (
        <li key={order.id}>
          <header>
            <div><strong>Pedido {order.code}</strong><p>{statusLabel(order.status)}</p></div>
            <strong>{formatCents(order.totalCents)}</strong>
          </header>
          <ul>
            {order.items.map((item, index) => {
              const choices = [
                ...(item.options ?? []).map((option) => `${option.groupName}: ${option.quantity > 1 ? `${option.quantity}× ` : ""}${option.name}`),
                ...(item.additionals ?? []).map((entry) => entry.name),
              ];
              return <li key={index}>
                {item.quantity} × {item.productName}
                {choices.length > 0 && <small>{choices.join(" · ")}</small>}
                {item.notes && <small>{item.notes}</small>}
              </li>;
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function MesaCardapioPage({ slug, token }: { slug: string; token: string }) {
  const path = `/stores/${encodeURIComponent(slug)}/tables/${encodeURIComponent(token)}`;
  const deviceKey = `vitrynow.table.${slug}.${token}`;
  const [menu, setMenu] = useState<TableMenu | null>(null);
  const [menuLoading, setMenuLoading] = useState(true);
  const [detail, setDetail] = useState<Product | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [orderName, setOrderName] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"cart" | "review" | "history" | null>(null);
  const [orders, setOrders] = useState<TableOrder[] | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [needsOrderCheck, setNeedsOrderCheck] = useState(false);
  const [needsPriceReview, setNeedsPriceReview] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const returnPoint = useRef<ReturnPoint | null>(null);

  useEffect(() => {
    try { setDevice(localStorage.getItem(deviceKey)); } catch { /* O pedido ainda pode ser acompanhado nesta aba. */ }
  }, [deviceKey]);

  const loadMenu = useCallback(async () => {
    setMenuLoading(true);
    try {
      const result = await operationRequest<TableMenu>(`${path}/menu`);
      if (result.ok) setMenu(result.data);
      else if (result.status === 404) {
        setMenu(null);
        setError("Este QR da mesa está indisponível. Peça o código atualizado ao atendente.");
      } else setError(result.error);
    } finally {
      setMenuLoading(false);
    }
  }, [path]);
  useEffect(() => { void loadMenu(); }, [loadMenu]);

  const accepting = !!menu?.qr.orderingEnabled && isStoreAcceptingOrders(menu.store);
  const products = useMemo(() => new Map(menu?.categories.flatMap((category) => category.products.map((product) => [product.id, product] as const))), [menu]);
  const categories = menu?.categories.filter((category) => category.products.length > 0) ?? [];
  const featured = categories.flatMap((category) => category.products
    .filter((product) => product.featured)
    .map((product) => ({ product, categoryIcon: category.icon })));
  const tableName = menu && (/^mesa\s/iu.test(menu.table.label) ? menu.table.label : `Mesa ${menu.table.label}`);
  const cart = useCart(products);
  const hasUnavailable = cart.cart.some((line) => cartLineMustBeReviewed(line, products.get(line.productId)));
  const belowMinimum = isBelowMinOrder(cart.totalCents, menu?.store.minOrderCents ?? null);

  useEffect(() => {
    if (detail) { window.scrollTo(0, 0); return; }
    const point = returnPoint.current;
    returnPoint.current = null;
    if (point && !dialog) restoreReturnPoint(document, point, (y) => window.scrollTo(0, y));
    else if (point) window.scrollTo(0, point.scrollY);
  }, [detail, dialog]);

  function openDetails(product: Product, index: number | null = null, featured = false) {
    returnPoint.current = { productId: product.id, scrollY: window.scrollY, featured };
    setEditing(index);
    setDialog(null);
    setDetail(product);
  }

  function closeDetails() {
    setDetail(null);
    if (editing !== null) setDialog("cart");
    setEditing(null);
  }

  function quickAdd(product: Product) {
    if (!accepting || product.soldOut || product.unavailableByOptions) return;
    if (quickAddMode(product) === "detail") openDetails(product);
    else cart.add(product.id, 1, [], "");
  }

  function rememberDevice(tokenValue: string) {
    setDevice(tokenValue);
    try { localStorage.setItem(deviceKey, tokenValue); } catch { /* O token permanece no estado desta aba. */ }
  }

  async function loadOrders(value = device) {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await operationRequest<{ orders: TableOrder[] }>(`${path}/my-orders`, "GET", undefined, value ? { "x-device-token": value } : undefined);
      if (!result.ok) {
        setHistoryError(result.error);
        return;
      }
      setOrders(result.data.orders);
      if (needsOrderCheck) {
        setError("");
        setNotice("Confira se o pedido aparece em Meus pedidos antes de reenviar.");
        setNeedsOrderCheck(false);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  async function sendOrder() {
    if (!cart.cart.length || !accepting || pending.current || hasUnavailable || belowMinimum || needsOrderCheck) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const sentDevice = device ?? newDeviceToken();
    rememberDevice(sentDevice);
    const body = {
      customerName: orderName.trim() || undefined,
      notes: orderNotes.trim() || undefined,
      items: quoteCart(cart.cart, products),
    };
    try {
      const result = await operationRequest<{ code: string; deviceToken?: string }>(`${path}/orders`, "POST", body, { "x-device-token": sentDevice });
      if (result.ok) {
        const value = result.data.deviceToken ?? sentDevice;
        if (value !== sentDevice) rememberDevice(value);
        cart.clear();
        setOrderNotes("");
        setNeedsPriceReview(false);
        setNotice(`Pedido ${result.data.code} enviado.`);
        setDialog("history");
        await loadOrders(value);
      } else if (result.status === 408 || result.status >= 500) {
        setNeedsOrderCheck(true);
        setError("Não foi possível confirmar o envio. Abra Meus pedidos para conferir antes de reenviar.");
      } else {
        if (orderNeedsUpdatedCatalog(result.code) || result.code === "STORE_CLOSED" || result.code === "QR_ORDERING_DISABLED" || result.status === 404) await loadMenu();
        if (result.code === "ITEM_PRICE_CHANGED") setNeedsPriceReview(true);
        setError(result.error);
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function alertStaff(action: "call-waiter" | "ask-bill") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await operationRequest<{ notified: boolean }>(`${path}/${action}`, "POST");
      if (result.ok) setNotice(result.data.notified ? "Equipe avisada." : "A equipe já foi avisada há pouco.");
      else setError(result.error);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const currentProduct = detail && products.get(detail.id);
  return (
    <div className={`loja mesa-cardapio ${lojaTitleFont.variable}`} style={lojaThemeStyle(menu?.store.primaryColor)}>
      {detail && menu ? (
        <ProductDetailScreen
          product={currentProduct || { ...detail, soldOut: true }}
          initialChoice={editing === null ? undefined : cart.cart[editing]}
          logoUrl={menu.store.logoUrl}
          closed={!accepting}
          onClose={closeDetails}
          onConfirm={(choice) => {
            if (!currentProduct || !accepting || currentProduct.soldOut || currentProduct.unavailableByOptions) return;
            if (editing === null) cart.add(detail.id, choice.quantity, choice.additionalIds, choice.notes, choice.optionSelections);
            else cart.edit(editing, choice);
            closeDetails();
          }}
        />
      ) : (
        <main className="mesa-cardapio__main">
          {!menu ? (
            menuLoading ? <MenuSkeleton /> : <div className="mesa-cardapio__message">
              <h1>Cardápio da mesa</h1>
              <p role="alert">{error}</p>
              <button className="loja__retry" type="button" onClick={() => { setError(""); void loadMenu(); }}>Tentar novamente</button>
            </div>
          ) : <>
            <StoreHeader
              store={menu.store}
              tableLabel={tableName ?? undefined}
              qrDisabled={!menu.qr.orderingEnabled}
              showCategoriesHead={false}
              onOpenSearch={() => undefined}
              onViewAllCategories={() => undefined}
              searchField={<div className="loja__search loja__search--editing">
                <SearchIcon size="md" />
                <input type="search" aria-label="Pesquisar no cardápio" placeholder="Pesquisar no cardápio" value={query} onChange={(event) => setQuery(event.target.value)} />
                {query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery("")}><CloseIcon /></button>}
              </div>}
            />
            <div id="cardapio-conteudo" tabIndex={-1} className="loja__content mesa-cardapio__content">
              <nav className="mesa-cardapio__actions" aria-label="Serviços da mesa">
                <button type="button" disabled={busy} onClick={() => void alertStaff("call-waiter")}><Icon name="bell" size={18} />Chamar atendente</button>
                <button type="button" disabled={busy} onClick={() => void alertStaff("ask-bill")}><Icon name="wallet" size={18} />Pedir a conta</button>
                <button type="button" onClick={() => { setDialog("history"); void loadOrders(); }}><Icon name="orders" size={18} />Meus pedidos</button>
              </nav>
              {error && !dialog && <p className="loja__warning" role="alert">{error}</p>}
              {notice && !dialog && <p className="mesa-cardapio__notice" role="status">{notice}</p>}
              {query.trim() ? (
                <SearchResults categories={categories} term={query} closed={!accepting || busy}
                  quantityByProduct={cart.quantityByProduct} onOpenProduct={openDetails} onQuickAdd={quickAdd}
                  onRemoveOne={(product) => cart.removeOne(product.id)} onClear={() => setQuery("")} />
              ) : <>
                {categories.length > 1 && <nav className="mesa-cardapio__categories" aria-label="Categorias">
                  {categories.map((category) => <a key={category.id} href={`#mesa-categoria-${encodeURIComponent(category.id)}`}>
                    {category.icon && <span aria-hidden="true">{category.icon}</span>}{category.name}
                  </a>)}
                </nav>}
                {!products.size && <p className="loja__empty-menu" role="status">Nenhum produto disponível no cardápio.</p>}
                {featured.length > 0 && <section className="loja__section" aria-labelledby="mesa-destaques">
                  <h2 className="loja__section-title" id="mesa-destaques">Destaques da casa</h2>
                  <div className="loja__list loja__list--featured">{featured.map(({ product, categoryIcon }) => (
                    <ProductListItem key={product.id} product={product} categoryIcon={categoryIcon} photoCard
                      quantityInCart={cart.quantityByProduct[product.id] ?? 0} closed={!accepting || busy}
                      onOpen={(picked) => openDetails(picked, null, true)} onQuickAdd={quickAdd} onRemoveOne={(picked) => cart.removeOne(picked.id)} />
                  ))}</div>
                </section>}
                {categories.map((category) => (
                  <section className="loja__section" id={`mesa-categoria-${category.id}`} key={category.id}>
                    <CategorySectionHeading category={category} />
                    <div className="loja__list">{category.products.map((product) => (
                      <ProductListItem key={product.id} product={product} quantityInCart={cart.quantityByProduct[product.id] ?? 0}
                        compact={isCompactCategory(category)}
                        closed={!accepting || busy} categoryIcon={category.icon} onOpen={openDetails} onQuickAdd={quickAdd}
                        onRemoveOne={(product) => cart.removeOne(product.id)} />
                    ))}</div>
                  </section>
                ))}
              </>}
            </div>
            {cart.itemCount > 0 && (
              <button className="loja__cart-bar" type="button" onClick={() => setDialog("cart")}>
                <span className="loja__cart-bar-left"><span className="loja__cart-bar-count">{cart.itemCount}</span>Ver carrinho</span>
                <strong className="loja__cart-bar-total">{formatCents(cart.totalCents)}</strong>
              </button>
            )}
            {dialog === "cart" && <CartDrawer cart={cart.cart} productsById={products} lineTotalCents={cart.lineTotalCents}
              totalCents={cart.totalCents} minOrderCents={menu.store.minOrderCents} closed={!accepting || busy}
              totalLabel="Total" onChangeQuantity={cart.changeQuantity} onEdit={(index, product) => openDetails(product, index)}
              onClose={() => setDialog(null)} onContinue={() => setDialog("review")} />}
            {dialog === "review" && <Sheet title="Revisar pedido da mesa" purchase onClose={() => { if (!busy) setDialog("cart"); }}>
              <form className="mesa-cardapio__form" onSubmit={(event) => { event.preventDefault(); void sendOrder(); }}>
                <div className="mesa-cardapio__review-table"><Icon name="orders" size={22} /><strong>{tableName}</strong></div>
                <label className="loja__label">Seu nome (opcional)<input className="loja__field" maxLength={60} value={orderName} onChange={(event) => setOrderName(event.target.value)} /></label>
                <label className="loja__label">Observação do pedido (opcional)<textarea className="loja__field" maxLength={500} rows={2} value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} /></label>
                <p>O pagamento é feito com a equipe.</p>
                {menu.qr.needsApproval && <p>Após o envio, aguarde a confirmação da equipe.</p>}
                {hasUnavailable && <p className="loja__warning" role="alert">Revise os itens no carrinho.</p>}
                {error && <p className="loja__warning" role="alert">{error}</p>}
                {needsOrderCheck && <button type="button" className="loja__retry" onClick={() => { setDialog("history"); void loadOrders(); }}>Conferir meus pedidos</button>}
                <button type="submit" className="loja__cta" disabled={busy || menuLoading || !accepting || hasUnavailable || belowMinimum || needsOrderCheck}>
                  {busy ? "Enviando…" : `${needsPriceReview ? "Confirmar novo valor" : "Enviar pedido"} · ${formatCents(cart.totalCents)}`}
                </button>
              </form>
            </Sheet>}
            {dialog === "history" && <Sheet title="Meus pedidos" onClose={() => setDialog(null)} purchase>
              {notice && <p className="mesa-cardapio__notice" role="status">{notice}</p>}
              {historyError && <p className="loja__warning" role="alert">{historyError}</p>}
              <TableHistory orders={orders} loading={historyLoading} />
              <button className="loja__retry" type="button" disabled={historyLoading} onClick={() => void loadOrders()}>Atualizar pedidos</button>
            </Sheet>}
          </>}
        </main>
      )}
    </div>
  );
}
