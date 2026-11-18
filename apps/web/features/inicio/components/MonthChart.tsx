import { formatCents } from "@/shared/format/money";
import type { DayPoint } from "../services/inicioMetrics";

const WIDTH = 640;
const HEIGHT = 242;
const PADDING = { top: 12, right: 8, bottom: 24, left: 8 };

export function MonthChart({ series }: { series: DayPoint[] }) {
  const max = Math.max(...series.map((point) => point.revenueCents), 1);
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const slot = innerWidth / series.length;
  const barWidth = Math.max(slot * 0.6, 2);

  return (
    <svg className="inicio-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Faturamento por dia no mês">
      <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={HEIGHT - PADDING.bottom} y2={HEIGHT - PADDING.bottom} stroke="#dddddd" />
      {series.map((point, index) => {
        const barHeight = (point.revenueCents / max) * innerHeight;
        const x = PADDING.left + index * slot + (slot - barWidth) / 2;
        return (
          <g key={point.day}>
            <rect x={x} y={HEIGHT - PADDING.bottom - barHeight} width={barWidth} height={Math.max(barHeight, point.revenueCents > 0 ? 2 : 0)} rx={2} fill="var(--color-primary)">
              <title>{`Dia ${point.day}: ${formatCents(point.revenueCents)}`}</title>
            </rect>
            {(point.day === 1 || point.day % 5 === 0) && (
              <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle" fontSize="10" fill="#6e6e6e">
                {point.day}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
