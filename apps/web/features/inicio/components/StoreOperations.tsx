import Link from "next/link";
import { Icon, type IconName } from "@/shared/icons/Icon";
import { StoreHeader } from "@/features/shell/components/StoreHeader";
import { StoreHoursCard } from "@/features/shell/components/StoreHoursCard";
import { useStore } from "@/features/shell/StoreProvider";
import { InventoryCard } from "./InventoryCard";

const links: { label: string; href: string; icon: IconName }[] = [
  { label: "Painel de pedidos", href: "/dashboard/pedidos", icon: "orders" },
  { label: "Abrir controle de caixa", href: "/dashboard/caixa", icon: "wallet" },
  { label: "Editar cores e banner", href: "/dashboard/conta/aparencia", icon: "settings" },
  { label: "Entregadores", href: "/dashboard/entregadores", icon: "delivery" },
  { label: "Impressoras", href: "/dashboard/impressoras", icon: "printer" },
  { label: "Cupons", href: "/dashboard/cupons", icon: "coupons" },
  { label: "Plano", href: "/dashboard/planos", icon: "plan" },
  { label: "Primeiros passos", href: "/dashboard/primeiros-passos", icon: "check" },
];

export function StoreOperations() {
  const store = useStore();
  return (
    <aside className="inicio-operations" aria-label="Operação da loja">
      {store && (
        <section className="inicio-card inicio-store">
          <div className="inicio-store__head">
            <h2>Minha loja</h2>
            <Link href={`/loja/${encodeURIComponent(store.slug)}`}>Ver cardápio <Icon name="chevronRight" size={14} /></Link>
          </div>
          <StoreHeader store={store} collapsed={false} />
          <dl className="inicio-store__channels">
            <div><dt>Entrega</dt><dd>{store.deliveryEnabled ? "Habilitada" : "Desativada"}</dd></div>
            <div><dt>Retirada</dt><dd>{store.pickupEnabled ? "Habilitada" : "Desativada"}</dd></div>
          </dl>
          <StoreHoursCard openingHours={store.openingHours} settingsHref="/dashboard/conta" acceptingOrders={store.acceptingOrders} />
        </section>
      )}
      <InventoryCard />
      <details className="inicio-card inicio-links">
        <summary>Atalhos da operação <Icon name="chevronDown" size={16} /></summary>
        <nav aria-label="Atalhos da operação">
          {links.map((link) => <Link key={link.href} href={link.href}><Icon name={link.icon} size={17} />{link.label}<Icon name="chevronRight" size={15} /></Link>)}
        </nav>
      </details>
    </aside>
  );
}
