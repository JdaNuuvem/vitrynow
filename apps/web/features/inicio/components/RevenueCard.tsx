"use client";

import Link from "next/link";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { Shine } from "@/shared/ui/Shine";
import { useHelp } from "@/features/ajuda/HelpWidget";
import type { InicioMetrics } from "../services/inicioMetrics";
import { MonthChart } from "./MonthChart";

type RevenueCardProps = {
  metrics: InicioMetrics | null;
  hidden: boolean;
  onToggleHidden: () => void;
  teamHref: string;
};

export function RevenueCard({ metrics, hidden, onToggleHidden, teamHref }: RevenueCardProps) {
  const { openHelp } = useHelp();

  return (
    <div className="inicio-card inicio-revenue">
      <p className="inicio-card__title">Faturamento</p>
      <div className="inicio-revenue__value">
        {metrics === null ? (
          <Shine width={160} height={32} />
        ) : (
          <p>{hidden ? "R$ ••••" : formatCents(metrics.revenueCents)}</p>
        )}
        <button type="button" className="inicio-revenue__toggle" onClick={onToggleHidden} aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}>
          <Icon name={hidden ? "eyeOff" : "eye"} size={20} />
        </button>
      </div>
      <div className="inicio-revenue__chart">
        {metrics === null ? <Shine height={242} /> : hidden ? <div className="inicio-revenue__hidden">Valores ocultos</div> : <MonthChart series={metrics.monthSeries} />}
      </div>
      <div className="inicio-revenue__footer">
        <p>
          <label>Quer ocultar valores dos funcionários?</label>
          <Link href={teamHref}>Crie usuários com acesso limitado</Link>
        </p>
        <button type="button" onClick={() => openHelp("feedback")}>
          Enviar sugestões
        </button>
      </div>
    </div>
  );
}
