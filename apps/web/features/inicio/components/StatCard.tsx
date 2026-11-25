import { Icon, type IconName } from "@/shared/icons/Icon";
import { Shine } from "@/shared/ui/Shine";

type StatCardProps = {
  title: string;
  value: string | null;
  period: string;
  icon: IconName;
  visibility?: { hidden: boolean; toggle: () => void };
};

export function StatCard({ title, value, period, icon, visibility }: StatCardProps) {
  return (
    <div className="inicio-stat">
      <div className="inicio-stat__head">
        <h2>{title}</h2>
        {visibility ? (
          <button type="button" className="inicio-hide" aria-label={visibility.hidden ? "Mostrar valores" : "Ocultar valores"} aria-pressed={visibility.hidden} onClick={visibility.toggle}>
            <Icon name={visibility.hidden ? "eyeOff" : "eye"} size={18} />
          </button>
        ) : <span className="inicio-stat__icon"><Icon name={icon} size={18} /></span>}
      </div>
      {value === null ? <Shine width="65%" height={28} /> : <p className="inicio-stat__value">{value}</p>}
      <p className="inicio-stat__period">{period}</p>
    </div>
  );
}
