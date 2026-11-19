"use client";

import type { Subscription } from "@/core/domain/subscription";
import { Button, StatusBadge } from "@/shared/design/components";
import { describeSubscription, featureLabel } from "../planPresentation";

type CurrentPlanCardProps = {
  subscription: Subscription;
  onCancel?: () => void;
};

export function CurrentPlanCard({ subscription, onCancel }: CurrentPlanCardProps) {
  const description = describeSubscription(subscription);

  return (
    <section className={`planos-current planos-current--${description.tone}`}>
      <div className="planos-current__top">
        <StatusBadge tone={description.tone === "ok" ? "success" : description.tone}>{description.badge}</StatusBadge>
        <h2>{description.headline}</h2>
      </div>
      <p>{description.detail}</p>
      {subscription.features.length > 0 && (
        <ul className="planos-current__features">
          {subscription.features.map((feature) => (
            <li key={feature}>{featureLabel(feature)}</li>
          ))}
        </ul>
      )}
      {subscription.state === "active" && onCancel && (
        <Button variant="danger" className="planos-current__cancel" onClick={onCancel}>
          Cancelar assinatura
        </Button>
      )}
    </section>
  );
}
