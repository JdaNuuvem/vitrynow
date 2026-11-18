"use client";

import type { PlanOffer } from "@/core/domain/subscription";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { BASELINE_FEATURES, featureLabel } from "../planPresentation";

type PlanOfferCardProps = {
  plan: PlanOffer;
  isCurrent: boolean;
  busy: boolean;
  onSubscribe: (planCode: string) => void;
};

export function PlanOfferCard({ plan, isCurrent, busy, onSubscribe }: PlanOfferCardProps) {
  const features = [...BASELINE_FEATURES, ...plan.features.map(featureLabel)];

  return (
    <article className={`planos-offer${isCurrent ? " is-current" : ""}`}>
      <header>
        <h3>{plan.name}</h3>
        {isCurrent && <span className="planos-offer__tag">Seu plano</span>}
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
      <button type="button" disabled={busy} onClick={() => onSubscribe(plan.code)}>
        {isCurrent ? "Renovar" : "Assinar"}
      </button>
    </article>
  );
}
