import Link from "next/link";
import type { OnboardingProgress } from "../onboarding";
import { Icon } from "@/shared/icons/Icon";

const RADIUS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function OnboardingWidget({ progress, href }: { progress: OnboardingProgress; href: string }) {
  const complete = progress.nextLabel === null;
  const offset = CIRCUMFERENCE * (1 - progress.done / progress.total);

  return (
    <Link href={href} className="onboarding-widget">
      <span className="onboarding-widget__ring" aria-hidden="true">
        <svg width="36" height="36" viewBox="0 0 36 36">
          <circle cx="18" cy="18" r={RADIUS} fill="none" stroke="#dddddd" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r={RADIUS}
            fill="none"
            stroke="#25a65b"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform="rotate(-90 18 18)"
          />
        </svg>
        <span className="onboarding-widget__count">{complete ? <Icon name="check" size={14} /> : `${progress.done}/${progress.total}`}</span>
      </span>
      <span className="onboarding-widget__texts">
        <span className="onboarding-widget__title">{complete ? "Loja configurada" : "Primeiros passos"}</span>
        <span className="onboarding-widget__sub">{complete ? "Tudo pronto para vender" : `Próximo: ${progress.nextLabel}`}</span>
      </span>
      <Icon name="chevronRight" size={16} />
      <span className="sr-only">
        {progress.done} de {progress.total} etapas concluídas
      </span>
    </Link>
  );
}
