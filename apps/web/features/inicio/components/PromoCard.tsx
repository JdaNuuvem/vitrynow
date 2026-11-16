"use client";

import { useRouter } from "next/navigation";
import { useFeatureUpgrade } from "@/features/planos/FeatureUpgradeContext";
import type { PromoCardConfig } from "../promoCards";

export function PromoCard({ config }: { config: PromoCardConfig }) {
  const router = useRouter();
  const { openUpgrade } = useFeatureUpgrade();

  function onAction() {
    if (config.action.kind === "link") router.push(config.action.href);
    else openUpgrade();
  }

  return (
    <div className={`inicio-promo inicio-promo--${config.tone}`}>
      <div className="inicio-promo__header">
        <p>{config.title}</p>
        <span className="inicio-promo__badge">{config.badge}</span>
      </div>
      <p className="inicio-promo__description">{config.description}</p>
      <button type="button" onClick={onAction}>
        Saiba mais
      </button>
    </div>
  );
}
