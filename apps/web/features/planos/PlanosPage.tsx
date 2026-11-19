"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useCurrentRole } from "@/core/session/useCurrentRole";
import { Button, PageHeading, StateMessage } from "@/shared/design/components";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { CurrentPlanCard } from "./components/CurrentPlanCard";
import { PixCheckoutModal } from "./components/PixCheckoutModal";
import { PlanOfferCard } from "./components/PlanOfferCard";
import { useCheckout } from "./hooks/useCheckout";
import { useRefreshPlanStatus } from "./usePlanStatus";
import { useSubscription } from "./hooks/useSubscription";
import "./planos.css";

export function PlanosPage() {
  const role = useCurrentRole();
  const { subscription, plans, loading, error: loadError, reload, cancel } = useSubscription();
  const refreshBanner = useRefreshPlanStatus();
  const checkout = useCheckout(useCallback(() => void Promise.all([reload(), refreshBanner()]), [reload, refreshBanner]));
  const [lastPlanCode, setLastPlanCode] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [cancelSuccess, setCancelSuccess] = useState(false);
  const cancelInProgress = useRef(false);
  const owner = role === "OWNER";

  function subscribe(planCode: string) {
    if (!owner || checkout.starting) return;
    setCancelSuccess(false);
    setLastPlanCode(planCode);
    checkout.start(planCode);
  }

  async function confirmCancel() {
    if (!owner || cancelInProgress.current) return;
    cancelInProgress.current = true;
    setCanceling(true);
    setCancelError(null);
    try {
      const failure = await cancel();
      if (failure) { setCancelError(failure); return; }
      setCancelSuccess(true);
      setConfirmingCancel(false);
      void refreshBanner();
    } catch {
      setCancelError("Não foi possível cancelar a assinatura. Tente novamente.");
    } finally {
      cancelInProgress.current = false;
      setCanceling(false);
    }
  }

  return (
    <main className="planos">
      <PageHeading title="Plano da loja" description="Acompanhe a assinatura, compare os planos e renove por Pix." />
      <div className="planos__messages">
        {loading && <StateMessage title="Consultando assinatura e planos" busy />}
        {loadError && <StateMessage title="Não foi possível consultar todos os dados" tone="danger" action={<Button onClick={reload}>Tentar novamente</Button>}>{loadError}</StateMessage>}
        {role === "STAFF" && <StateMessage title="Consulta de planos">O dono da loja pode assinar, renovar e cancelar o plano.</StateMessage>}
        {cancelSuccess && <StateMessage title="Assinatura cancelada" tone="success" />}
        {checkout.error && <StateMessage title="Não foi possível abrir o pagamento" tone="danger" action={checkout.errorCode === "EMAIL_NOT_VERIFIED"
          ? <Link href="/dashboard/primeiros-passos" className="ds-button ds-button--secondary">Confirmar e-mail</Link>
          : lastPlanCode && <Button onClick={() => subscribe(lastPlanCode)}>Tentar novamente</Button>}>{checkout.error}</StateMessage>}
      </div>
      {subscription && <CurrentPlanCard subscription={subscription} onCancel={owner ? () => setConfirmingCancel(true) : undefined} />}
      {plans.length > 0 ? <section aria-labelledby="plan-offers">
        <h2 className="planos__subtitle" id="plan-offers">Planos disponíveis</h2>
        <div className="planos__offers">
          {plans.map((plan) => (
            <PlanOfferCard
              key={plan.code}
              plan={plan}
              isCurrent={subscription?.planCode === plan.code && (subscription.state === "active" || subscription.state === "canceled")}
              busy={checkout.starting}
              onSubscribe={owner ? subscribe : undefined}
            />
          ))}
        </div>
      </section> : !loading && !loadError && <StateMessage title="Sem planos disponíveis no momento" />}

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
          if (cancelInProgress.current) return;
          setConfirmingCancel(false);
          setCancelError(null);
        }}
      />
    </main>
  );
}
