"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/shared/icons/Icon";

export function StoreHoursCard({ openingHours, settingsHref, acceptingOrders }: { openingHours: string | null; settingsHref: string; acceptingOrders: boolean }) {
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

  return (
    <div className={`shell-hours${expanded ? " is-expanded" : ""}`}>
      <button type="button" className="shell-hours__summary" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
        <span className={`shell-hours__status${acceptingOrders ? " is-open" : " is-closed"}`}>
          {acceptingOrders && <span className="shell-hours__dot" />}
          {acceptingOrders ? "Recebendo pedidos" : "Pedidos pausados"}
        </span>
        <span className="shell-hours__action">
          {expanded ? "Fechar" : "Ver horários"}
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      {expanded && (
        <div className="shell-hours__details">
          <p className="shell-hours__title">Horários de funcionamento</p>
          <p>{openingHours}</p>
        </div>
      )}
    </div>
  );
}
