// API-10 (RN-A-06, ADR-0003 §2.4): QUAIS avisos de assinatura estão devidos agora. Função PURA (sem banco, sem relógio): o job entrega a data e
// grava o que enviou. Regras:
//  - 7, 3 e 1 dia ANTES do vencimento (fim do teste ou do período pago): D7, D3, D1;
//  - 1 e-mail na ENTRADA em Consulta (READ_ONLY) e 1 na entrada em Suspensão (SUSPENDED);
//  - cada aviso vale para UM vencimento (`dueAt`): renovar o plano muda o vencimento e reabre a série.
// "Atrasado" não vira rajada: se o job ficou fora do ar e a loja já está a 2 dias do fim, só o D1 faz sentido; os mais distantes (D7 e D3)
// não são enviados depois da hora, e o aviso de uma fase que já passou não é enviado quando a loja já está numa fase mais adiantada.
import { READ_ONLY_DAYS } from "./entitlements";

export const NOTICE_KINDS = ["D7", "D3", "D1", "READ_ONLY", "SUSPENDED"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export type NoticeSubject = {
  status: "TRIAL" | "ACTIVE" | "CANCELED";
  trialEndsAt: Date;
  currentPeriodEnd: Date | null;
};

/** O vencimento que vale agora: fim do teste (TRIAL) ou do período pago (demais). Sem período pago, cai no fim do teste. */
export function dueAtOf(subject: NoticeSubject): Date {
  return subject.status === "TRIAL" ? subject.trialEndsAt : (subject.currentPeriodEnd ?? subject.trialEndsAt);
}

/**
 * O aviso DEVIDO agora (no máximo um por rodada: o da janela em que a loja está) ou `null`.
 * `daysLeft` conta dias inteiros restantes até `dueAt`: 7 ⇒ D7, 3 ⇒ D3, 1 ⇒ D1, usando janelas de 24 h (ex.: D7 vale de 7 a 6 dias antes).
 * Assinatura CANCELADA com período pago ainda correndo AVISA o fim também (o dono precisa saber quando perde o acesso).
 */
export function dueNotice(subject: NoticeSubject, now: Date): { kind: NoticeKind; dueAt: Date } | null {
  const dueAt = dueAtOf(subject);
  const untilDue = dueAt.getTime() - now.getTime();
  if (untilDue > 0) {
    // ainda dentro do período: janelas de antecedência (a mais próxima do vencimento vence)
    if (untilDue <= 1 * DAY_MS) return { kind: "D1", dueAt };
    if (untilDue <= 3 * DAY_MS) return { kind: "D3", dueAt };
    if (untilDue <= 7 * DAY_MS) return { kind: "D7", dueAt };
    return null;
  }
  const suspendedAt = dueAt.getTime() + READ_ONLY_DAYS * DAY_MS;
  return now.getTime() < suspendedAt ? { kind: "READ_ONLY", dueAt } : { kind: "SUSPENDED", dueAt };
}

/** Texto FIXO por tipo (sem dado da loja, do plano, do valor nem do pagamento): o aviso promete só o que existe. */
export const NOTICE_TEXT: Record<NoticeKind, { subject: string; lines: string[] }> = {
  D7: { subject: "Sua assinatura vence em 7 dias — MeuCardapio", lines: ["Faltam cerca de 7 dias para o fim do seu período.", "Para continuar recebendo pedidos sem interrupção, renove em Plano e pagamento no painel."] },
  D3: { subject: "Sua assinatura vence em 3 dias — MeuCardapio", lines: ["Faltam cerca de 3 dias para o fim do seu período.", "Renove em Plano e pagamento no painel para não interromper os pedidos."] },
  D1: { subject: "Sua assinatura vence amanhã — MeuCardapio", lines: ["Falta cerca de 1 dia para o fim do seu período.", "Renove hoje em Plano e pagamento no painel para não interromper os pedidos."] },
  READ_ONLY: {
    subject: "Sua loja está só em modo consulta — MeuCardapio",
    lines: ["Seu período terminou. Por alguns dias o painel fica só para consulta e o cardápio não recebe pedidos novos.", "Seus dados continuam guardados. Pague em Plano e pagamento para voltar na hora."],
  },
  SUSPENDED: {
    subject: "Sua loja está suspensa — MeuCardapio",
    lines: ["Seu período terminou e a loja está suspensa: só a tela de pagamento e a exportação dos seus dados ficam abertas.", "Não apagamos seus dados por falta de pagamento. Pague para reativar na hora."],
  },
};
