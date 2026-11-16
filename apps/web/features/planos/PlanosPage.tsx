"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { CurrentPlanCard } from "./components/CurrentPlanCard";
import { PixCheckoutModal } from "./components/PixCheckoutModal";
import { PlanOfferCard } from "./components/PlanOfferCard";
import { useCheckout } from "./hooks/useCheckout";
import { useRefreshPlanStatus } from "./usePlanStatus";
import { useSubscription } from "./hooks/useSubscription";
import "./planos.css";

export function PlanosPage() {
  const { subscription, plans, error: loadError, reload, cancel } = useSubscription();
  const refreshBanner = useRefreshPlanStatus();
  const checkout = useCheckout(useCallback(() => void Promise.all([reload(), refreshBanner()]), [reload, refreshBanner]));
  const [lastPlanCode, setLastPlanCode] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  function subscribe(planCode: string) {
    setLastPlanCode(planCode);
    checkout.start(planCode);
  }

  async function confirmCancel() {
    setCanceling(true);
    const failure = await cancel();
    setCanceling(false);
    setCancelError(failure);
    if (!failure) setConfirmingCancel(false);
  }

  return (
    <main className="planos">
      <h1>Plano</h1>

      {loadError && <p className="planos__error">{loadError}</p>}
      {subscription && <CurrentPlanCard subscription={subscription} onCancel={() => setConfirmingCancel(true)} />}
      {checkout.error && <p className="planos__error">{checkout.error}</p>}

      <h2 className="planos__subtitle">Escolha seu plano</h2>
      <div className="planos__offers">
        {plans.map((plan) => (
          <PlanOfferCard
            key={plan.code}
            plan={plan}
            isCurrent={subscription?.planCode === plan.code && (subscription.state === "active" || subscription.state === "canceled")}
            busy={checkout.starting}
            onSubscribe={subscribe}
          />
        ))}
      </div>

      <PixCheckoutModal
        payment={checkout.payment}
        status={checkout.status}
        onClose={checkout.reset}
        onRetry={() => lastPlanCode && checkout.start(lastPlanCode)}
      />

      <ConfirmDialog
        open={confirmingCancel}
        title="Cancelar assinatura?"
        message="Você continua com acesso até o fim do período já pago. Depois disso, os recursos do plano são bloqueados."
        confirmLabel="Cancelar assinatura"
        cancelLabel="Manter plano"
        tone="danger"
        busy={canceling}
        error={cancelError}
        onConfirm={confirmCancel}
        onCancel={() => {
          setConfirmingCancel(false);
          setCancelError(null);
        }}
      />
    </main>
  );
}
