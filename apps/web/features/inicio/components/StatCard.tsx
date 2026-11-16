import { Shine } from "@/shared/ui/Shine";

type StatCardProps = {
  title: string;
  value: string | null;
};

export function StatCard({ title, value }: StatCardProps) {
  return (
    <div className="inicio-stat">
      <p className="inicio-stat__title">{title}</p>
      {value === null ? <Shine width={150} height={40} /> : <p className="inicio-stat__value">{value}</p>}
    </div>
  );
}
