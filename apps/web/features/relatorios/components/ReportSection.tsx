import { DataTable, Panel, StateMessage } from "@/shared/design/components";

export type ReportRow = { key: string; label: string; value: string | number; share?: number };

// Cartão com título e linhas "rótulo ........ valor" — formato comum a todas as seções.
// `rows` vazio mostra `emptyText`.
export function ReportSection({ title, rows, emptyText }: { title: string; rows: ReportRow[]; emptyText?: string }) {
  return (
    <Panel title={title}>
      {rows.length > 0 ? <DataTable label={title} headers={["Item", "Resultado"]}>
        {rows.map((row) => <tr key={row.key}>
          <th scope="row">{row.label}
          {row.share !== undefined && (
            <div className="relatorios__track" aria-hidden="true">
              <i data-type={row.key} style={{ width: `${Math.min(100, Math.max(0, row.share * 100))}%` }} />
            </div>
          )}</th>
          <td>{row.value}</td>
        </tr>)}
      </DataTable> : <StateMessage title={emptyText ?? "Sem dados no período."} />}
    </Panel>
  );
}
