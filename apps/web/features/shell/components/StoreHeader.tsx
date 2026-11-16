"use client";

import { useState } from "react";
import type { StoreSettings } from "@/core/domain/store";
import { Icon } from "@/shared/icons/Icon";
import { Switch } from "@/shared/ui/Switch";
import { useStoreActions } from "../StoreProvider";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

export function StoreAvatar({ store }: { store: StoreSettings }) {
  return store.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="shell-avatar" src={store.logoUrl} alt="" />
  ) : (
    <div className="shell-avatar shell-avatar--initials" aria-hidden="true">
      {initialsOf(store.name)}
    </div>
  );
}

export function StoreHeader({ store, collapsed }: { store: StoreSettings; collapsed: boolean }) {
  const [copied, setCopied] = useState(false);
  const { setAcceptingOrders } = useStoreActions();

  async function toggleAvailability(accepting: boolean) {
    const failure = await setAcceptingOrders(accepting);
    if (failure) alert(failure);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/loja/${store.slug}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="shell-store">
      <StoreAvatar store={store} />
      {!collapsed && (
        <div className="shell-store__texts">
          <h6 className="shell-store__name">{store.name}</h6>
          <button type="button" className="shell-store__link" onClick={copyLink}>
            <Icon name={copied ? "check" : "copy"} size={14} />
            <span>{copied ? "Copiado!" : "Copiar link"}</span>
          </button>
          <div className="shell-store__availability">
            <p>{store.acceptingOrders ? "Disponível" : "Indisponível"}</p>
            <Switch checked={store.acceptingOrders} onChange={toggleAvailability} label="Receber pedidos" />
          </div>
        </div>
      )}
    </div>
  );
}
