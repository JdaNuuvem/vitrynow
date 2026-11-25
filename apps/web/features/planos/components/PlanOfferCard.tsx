"use client";

import type { PlanOffer } from "@/core/domain/subscription";
import { Button, StatusBadge } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { BASELINE_FEATURES, featureLabel } from "../planPresentation";

type PlanOfferCardProps = {
  plan: PlanOffer;
  isCurrent: boolean;
  busy: boolean;
  onSubscribe?: (planCode: string) => void;
};

export function PlanOfferCard({ plan, isCurrent, busy, onSubscribe }: PlanOfferCardProps) {
  const features = [...new Set([...BASELINE_FEATURES, ...plan.features.map(featureLabel)])];
  const maxUsers = plan.limits?.maxUsers;
  const maxPrinters = plan.limits?.maxPrinters;

  return (
    <article className={`planos-offer${isCurrent ? " is-current" : ""}`}>
      <header>
        <h3>{plan.name}</h3>
        {isCurrent && <StatusBadge tone="success">Seu plano</StatusBadge>}
      </header>
      <p className="planos-offer__price">
        <strong>{formatCents(plan.priceCents)}</strong>
        <span>/mês</span>
      </p>
      <ul>
        {features.map((feature) => (
          <li key={feature}>
            <Icon name="check" size={16} />
            {feature}
          </li>
        ))}
      </ul>
      {(maxUsers !== undefined || maxPrinters !== undefined) && <dl className="planos-offer__limits">
        {maxUsers !== undefined && <div><dt>Usuários</dt><dd>{maxUsers ?? "Sem limite"}</dd></div>}
        {maxPrinters !== undefined && <div><dt>Impressoras</dt><dd>{maxPrinters ?? "Sem limite"}</dd></div>}
      </dl>}
      {onSubscribe && <Button variant={isCurrent ? "secondary" : "primary"} disabled={busy} onClick={() => onSubscribe(plan.code)}>
        {isCurrent ? "Renovar" : "Assinar"}
      </Button>}
    </article>
  );
}
