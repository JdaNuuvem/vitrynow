import type { ReactNode } from "react";
import { Button, PageHeading, Pagination, StateMessage, StatusBadge } from "@/shared/design/components";
import type { PlatformSubscription } from "./platformApi";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
const PLATFORM_PHASE: Record<PlatformSubscription["phase"], string> = {
  TRIAL: "Em teste", ACTIVE: "Ativo", READ_ONLY: "Em consulta", SUSPENDED: "Suspenso",
};

export function platformDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

export function PlatformHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <PageHeading title={title} description={description} actions={action} />;
}

export function PlatformState({ loading, error, retry, children }: { loading?: boolean; error?: string | null; retry?: () => void; children?: ReactNode }) {
  if (loading) return <StateMessage busy title="Carregando…" />;
  if (error) return <StateMessage tone="danger" title={error} action={retry ? <Button onClick={retry}>Tentar novamente</Button> : undefined} />;
  return <p className="platform-muted">{children}</p>;
}

export function StoreStatus({ suspended, subscription }: { suspended: boolean; subscription: PlatformSubscription | null }) {
  if (suspended) return <StatusBadge tone="danger">Suspensa pela plataforma</StatusBadge>;
  if (!subscription) return <StatusBadge>Sem assinatura</StatusBadge>;
  const tone = subscription.phase === "ACTIVE" ? "success" : subscription.phase === "SUSPENDED" ? "danger" : "warning";
  return <StatusBadge tone={tone}>{PLATFORM_PHASE[subscription.phase]}</StatusBadge>;
}

export function PlatformPagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (page > last) return <Button onClick={() => onChange(last)}>Voltar à última página</Button>;
  return <Pagination page={page} totalPages={last} onPageChange={onChange} />;
}
