"use client";

import Link from "next/link";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, StateMessage } from "@/shared/design/components";
import { Icon, type IconName } from "@/shared/icons/Icon";
import { campaignEnabled } from "./campanha/campaignGateways";
import { ChangePasswordCard } from "./components/ChangePasswordCard";
import { StoreSettingsCard } from "./components/StoreSettingsCard";
import { useConta } from "./hooks/useConta";
import "./conta.css";

const storeLinks: { href: string; label: string; description: string; icon: IconName }[] = [
  { href: "/dashboard/conta/aparencia", label: "Aparência do cardápio", description: "Cor, banner principal e logotipo.", icon: "store" },
  { href: "/dashboard/conta/horarios", label: "Horários e preparo", description: "Agenda, pausas e tempos de preparo.", icon: "clock" },
  { href: "/dashboard/conta/entrega", label: "Bairros e taxas de entrega", description: "Áreas atendidas e regras de preço.", icon: "delivery" },
];

export function ContaPage() {
  const { store, save, changePassword, loadError, reload } = useConta();
  const role = useCurrentRole();
  const links = [...storeLinks];
  if (role === "OWNER") {
    links.push({ href: "/dashboard/pagamentos", label: "Recebimento por Pix", description: "Conta Mercado Pago da loja.", icon: "payments" });
    if (campaignEnabled || process.env.NODE_ENV === "development") links.push({
      href: campaignEnabled ? "/dashboard/conta/campanha" : "/dev/campanha", label: "Campanha do cardápio",
      description: campaignEnabled ? "Destaque com imagem, texto e destino." : "Prévia de desenvolvimento do editor.", icon: "products",
    });
  }

  if (!store) return (
    <main className="conta">
      <PageHeading title="Minha loja" />
      {loadError ? <StateMessage title="Dados da loja indisponíveis" tone="danger"
        action={<Button onClick={() => void reload()}>Tentar novamente</Button>}>{loadError}</StateMessage>
        : <StateMessage title="Carregando dados da loja" busy />}
    </main>
  );

  return (
    <main className="conta">
      <PageHeading title="Minha loja" description="Gerencie como a loja atende e aparece para os clientes." />
      <nav className="conta__links" aria-label="Configurações da loja">
        {links.map(({ href, icon, label, description }) => (
          <Link key={href} className="conta__shortcut" href={href}>
            <Icon name={icon} size={22} aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span>
            <Icon name="chevronRight" size={16} aria-hidden="true" />
          </Link>
        ))}
      </nav>
      <div className="conta__grid">
        <StoreSettingsCard key={store.id} store={store} onSave={save} editable={role === "OWNER"} canEditCatalogPolicy={role === "OWNER"} />
        <ChangePasswordCard onChangePassword={changePassword} />
      </div>
    </main>
  );
}
