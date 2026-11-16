import type { DateRange } from "../dateRange";

export function DateRangeFilter({ range, onChange }: { range: DateRange; onChange: (range: DateRange) => void }) {
  return (
    <div className="relatorios__filter">
      <label>
        De
        <input type="date" value={range.from} onChange={(event) => onChange({ ...range, from: event.target.value })} />
      </label>
      <label>
        Até
        <input type="date" value={range.to} onChange={(event) => onChange({ ...range, to: event.target.value })} />
      </label>
    </div>
  );
}
