import { Icon, type IconName } from "@/shared/icons/Icon";
import { Shine } from "@/shared/ui/Shine";
import type { InicioMetrics } from "../services/inicioMetrics";

const TYPES: { key: keyof InicioMetrics["orderTypes"]; label: string; icon: IconName }[] = [
  { key: "delivery", label: "Delivery", icon: "delivery" },
  { key: "table", label: "Mesas", icon: "mesa" },
  { key: "pickup", label: "Retirada", icon: "pickup" },
];

export function OrderTypesCard({ orderTypes }: { orderTypes: InicioMetrics["orderTypes"] | null }) {
  return (
    <div className="inicio-card inicio-types">
      <p className="inicio-card__title inicio-card__title--large">Formas mais pedidas</p>
      <div className="inicio-types__row">
        {TYPES.map((type) => (
          <div key={type.key} className="inicio-types__item">
            <Icon name={type.icon} size={20} />
            <p>{type.label}</p>
            {orderTypes === null ? <Shine width={74} height={32} /> : <p className="inicio-types__count">{orderTypes[type.key]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
