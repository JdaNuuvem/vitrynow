import { formatCents } from "@/shared/format/money";
import { Shine } from "@/shared/ui/Shine";
import { PLATFORM_FEE_RATE } from "../services/inicioMetrics";

export function SavingsCard({ savingsCents, hidden }: { savingsCents: number | null; hidden: boolean }) {
  const percent = Math.round(PLATFORM_FEE_RATE * 100);
  const empty = savingsCents === 0;

  return (
    <div className="inicio-stat inicio-stat--green">
      <p className="inicio-stat__title">Economia com taxas</p>
      {savingsCents === null ? (
        <Shine width={150} height={40} />
      ) : empty ? (
        <p className="inicio-stat__note inicio-stat__note--large">Comece a vender e deixe de pagar {percent}% do seu faturamento em taxas à plataformas!</p>
      ) : (
        <div className="inicio-stat__row">
          <p className="inicio-stat__value">{hidden ? "R$ ••••" : formatCents(savingsCents)}</p>
          <p className="inicio-stat__note">Deixou de pagar {percent}% do faturamento à plataformas.</p>
        </div>
      )}
    </div>
  );
}
