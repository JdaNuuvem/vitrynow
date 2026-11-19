import Link from "next/link";
import { useHelp } from "@/features/ajuda/HelpWidget";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { useRevenueNotice } from "../hooks/useRevenueNotice";
import type { InicioMetrics } from "../services/inicioMetrics";
import { MonthChart } from "./MonthChart";

type RevenueMetrics = Pick<InicioMetrics, "revenueCents" | "tipCents" | "awaiting" | "awaitingKnown" | "chartExact" | "monthSeries">;
type Props = { metrics: RevenueMetrics; hidden: boolean; onToggleHidden: () => void; teamHref: string };

export function RevenueCard({ metrics, hidden, onToggleHidden, teamHref }: Props) {
  const { openHelp } = useHelp();
  const notice = useRevenueNotice();
  const hasMoney = metrics.revenueCents !== undefined;
  const money = (cents: number) => hidden ? "R$ ••••" : formatCents(cents);
  return (
    <section className="inicio-card inicio-revenue">
      <div className="inicio-section-title"><h2>{hasMoney ? "Faturamento do mês" : "Vendas do mês"}</h2><Link href="/dashboard/relatorios">Ver relatório</Link></div>
      {metrics.revenueCents !== undefined && (
        <div className="inicio-revenue__value"><strong>{money(metrics.revenueCents)}</strong>
          <button type="button" onClick={onToggleHidden} aria-label={hidden ? "Mostrar valores do gráfico" : "Ocultar valores do gráfico"}><Icon name={hidden ? "eyeOff" : "eye"} size={18} /></button>
        </div>
      )}
      {hasMoney && notice.visible && (
        <div className="inicio-revenue__notice" role="note">
          <p>Mudamos como contamos o faturamento. Agora contam só pedidos aceitos.</p>
          <button type="button" onClick={notice.dismiss}>Entendi</button>
        </div>
      )}
      {metrics.awaiting.count > 0 && (
        <p className="inicio-muted">Aguardando aceite: {metrics.awaiting.count} {metrics.awaiting.count === 1 ? "pedido" : "pedidos"}{hasMoney && metrics.awaiting.cents !== undefined && ` · ${money(metrics.awaiting.cents)}`} (ainda não contam)</p>
      )}
      {hasMoney && metrics.tipCents !== undefined && metrics.tipCents > 0 && <p className="inicio-muted">Gorjetas: {money(metrics.tipCents)} (não entram no faturamento)</p>}
      {!metrics.awaitingKnown && <p className="inicio-muted">Não deu para separar os pedidos aguardando aceite agora: o valor pode incluí-los.</p>}
      <MonthChart series={metrics.monthSeries} hideMoney={!hasMoney || hidden} />
      {hasMoney && !metrics.chartExact && !hidden && <p className="inicio-muted">O gráfico ainda inclui as gorjetas.</p>}
      <div className="inicio-revenue__footer">
        <Link href={teamHref}>Gerenciar acessos da equipe</Link>
        <button type="button" onClick={() => openHelp("feedback")}>Enviar sugestão</button>
      </div>
    </section>
  );
}
