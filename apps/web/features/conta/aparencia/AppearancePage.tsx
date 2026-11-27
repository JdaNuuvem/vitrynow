"use client";

import Link from "next/link";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, StateMessage } from "@/shared/design/components";
import { Icon } from "@/shared/icons/Icon";
import { useConta } from "../hooks/useConta";
import { AppearanceEditor } from "./AppearanceEditor";
import { MenuLayoutSetting } from "./MenuLayoutSetting";
import "./appearance.css";

export function AppearancePage() {
  const { store, save, loadError, reload } = useConta();
  const role = useCurrentRole();

  return (
    <main className="appearance">
      <PageHeading title="Aparência do cardápio" description="Personalize a cor de destaque, o logotipo e o banner principal." actions={store && (
          <Link className="ds-button ds-button--secondary" href={`/loja/${encodeURIComponent(store.slug)}`} target="_blank" rel="noopener noreferrer">
            <Icon name="eye" aria-hidden="true" />
            Abrir cardápio
          </Link>
        )}>
        <Link className="ds-button ds-button--quiet" href="/dashboard/conta">Voltar a Minha loja</Link>
      </PageHeading>
      {store ? <MenuLayoutSetting key={`layout-${store.id}`} store={store} canEdit={role === "OWNER"} onSave={save} /> : null}
      {store ? <AppearanceEditor key={store.id} store={store} canEdit={role === "OWNER"} readOnly={role === "STAFF"} onSave={save} />
        : loadError ? (
          <StateMessage title="Aparência indisponível" tone="danger" action={<Button onClick={() => void reload()}>Tentar novamente</Button>}>{loadError}</StateMessage>
        ) : <StateMessage title="Carregando a identidade da loja" busy />}
    </main>
  );
}
