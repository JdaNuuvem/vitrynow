"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/shared/icons/Icon";
import { isStoreOpenNow } from "@/lib/openingHours";

export function StoreHoursCard({ openingHours, settingsHref, acceptingOrders = true }: { openingHours: string | null; settingsHref: string; acceptingOrders?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!openingHours) {
    return (
      <div className="shell-hours">
        <Link href={settingsHref} className="shell-hours__summary">
          <span className="shell-hours__action">Definir horários</span>
        </Link>
      </div>
    );
  }

  const open = acceptingOrders ? isStoreOpenNow(openingHours) : false;
  return (
    <div className={`shell-hours${expanded ? " is-expanded" : ""}`}>
      <div className="shell-hours__summary" role="button" tabIndex={0} onClick={() => setExpanded((v) => !v)} onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}>
        {open !== null && (
          <span className={`shell-hours__status${open ? " is-open" : " is-closed"}`}>
            {open && <span className="shell-hours__dot" />}
            {open ? "Aberto agora" : acceptingOrders ? "Fechado" : "Pedidos pausados"}
          </span>
        )}
        <span className="shell-hours__action">
          {expanded ? "Fechar" : "Ver horários"}
          <Icon name="chevronDown" size={14} />
        </span>
      </div>
      {expanded && (
        <div className="shell-hours__details">
          <p className="shell-hours__title">Horários de funcionamento</p>
          <p>{openingHours}</p>
        </div>
      )}
    </div>
  );
}
