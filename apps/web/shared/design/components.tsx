import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "@/shared/icons/Icon";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  icon?: IconName;
  busy?: boolean;
};

export function Button({ variant = "secondary", type = "button", className, icon, busy, disabled, children, ...props }: ButtonProps) {
  const classes = ["ds-button", "ds-button--" + variant, className].filter(Boolean).join(" ");
  return (
    <button {...props} className={classes} type={type} aria-busy={busy || undefined} disabled={disabled || busy}>
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  );
}

export function PageHeading({ title, description, actions, children }: {
  title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode;
}) {
  return (
    <header className="ds-heading">
      <div>
        {children}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ds-heading__actions">{actions}</div>}
    </header>
  );
}

export function Panel({ title, actions, children, className }: {
  title?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={["ds-panel", className].filter(Boolean).join(" ")}>
      {(title || actions) && <header className="ds-panel__header">{title && <h2>{title}</h2>}{actions}</header>}
      <div className="ds-panel__body">{children}</div>
    </section>
  );
}

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={"ds-status ds-tone--" + tone}>{children}</span>;
}

export function StateMessage({ tone = "neutral", title, children, action, busy }: {
  tone?: Tone; title: string; children?: ReactNode; action?: ReactNode; busy?: boolean;
}) {
  const icon = tone === "danger" ? "alert" : tone === "success" ? "check" : "info";
  return (
    <div className={"ds-state ds-tone--" + tone} role={tone === "danger" ? "alert" : "status"} aria-busy={busy || undefined}>
      <Icon name={icon} size={20} />
      <div><strong>{title}</strong>{children && <div className="ds-state__detail">{children}</div>}</div>
      {action && <div className="ds-state__action">{action}</div>}
    </div>
  );
}

export function Field({ id, label, hint, error, children }: {
  id: string; label: string; hint?: string; error?: string; children: ReactNode;
}) {
  return (
    <div className="ds-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p id={id + "-hint"}>{hint}</p>}
      {error && <p id={id + "-error"} className="ds-field__error" role="alert">{error}</p>}
    </div>
  );
}

export function DataTable({ label, headers, children }: {
  label: string; headers: readonly ReactNode[]; children: ReactNode;
}) {
  return (
    <div className="ds-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="ds-table">
        <caption className="sr-only">{label}</caption>
        <thead><tr>{headers.map((label, index) => <th scope="col" key={index}>{label}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, onPageChange, busy }: {
  page: number; totalPages: number; onPageChange: (page: number) => void; busy?: boolean;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="ds-pagination" aria-label="Paginação">
      <Button icon="chevronLeft" disabled={busy || page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</Button>
      <span aria-live="polite">{page} de {totalPages}</span>
      <Button disabled={busy || page >= totalPages} onClick={() => onPageChange(page + 1)}>Próxima <Icon name="chevronRight" size={17} /></Button>
    </nav>
  );
}
