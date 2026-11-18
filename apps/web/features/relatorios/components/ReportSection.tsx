export type ReportRow = { key: string; label: string; value: string | number };

// Cartão com título e linhas "rótulo ........ valor" — formato comum a todas as seções.
// `rows` vazio mostra `emptyText`.
export function ReportSection({ title, rows, emptyText }: { title: string; rows: ReportRow[]; emptyText?: string }) {
  return (
    <section className="relatorios__section">
      <h2>{title}</h2>
      {rows.map((row) => (
        <div key={row.key} className="relatorios__row">
          <span>{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
      {rows.length === 0 && emptyText && <p className="relatorios__empty">{emptyText}</p>}
    </section>
  );
}
