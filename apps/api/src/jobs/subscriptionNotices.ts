import { sendSubscriptionNoticeEmail } from "../lib/email";
import { dueNotice, NOTICE_TEXT } from "../lib/subscriptionNotices";
import { errorTag } from "./errorTag";
import { claimWithLock } from "./lock";
import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";

// API-10 — avisos de assinatura (RN-A-06, ADR-0003 §2.4): 7, 3 e 1 dia antes do vencimento + 1 na entrada em Consulta + 1 na entrada em Suspensão,
// por e-mail ao OWNER (a faixa do painel já vem do `daysLeft`/`phase` da assinatura). Job "por nível" e idempotente: cada tick reavalia as lojas
// com vencimento próximo ou recém-vencido e envia só o que FALTA; o que garante "uma vez" é a chave única `SubscriptionNotice(assinatura, tipo,
// vencimento)`. A reserva da linha vem ANTES do envio (quem perde a corrida não envia) e é DESFEITA se o e-mail não saiu (tenta no próximo tick).
// Em Suspensão o dono ainda recebe o e-mail de entrada (uma vez) mas nunca mais nada: sem spam.
const DAY_MS = 24 * 60 * 60 * 1000;

export const subscriptionNoticesJob: Job = {
  name: "subscription.notices",
  everyMs: 60 * 60 * 1000,
  lockKey: JOB_LOCK_KEYS["subscription.notices"],
  limit: 200,
  async runOnce({ now, db, limit, log }) {
    // Só quem pode ter aviso devido: vencimento a até 7 dias à frente ou vencido há até 8 dias (7 de consulta + o dia da suspensão).
    const claimed = await claimWithLock(db, JOB_LOCK_KEYS["subscription.notices"], async (tx) =>
      tx.subscription.findMany({
        where: {
          OR: [
            { status: "TRIAL", trialEndsAt: { gt: new Date(now.getTime() - 8 * DAY_MS), lte: new Date(now.getTime() + 7 * DAY_MS) } },
            { status: { in: ["ACTIVE", "CANCELED"] }, currentPeriodEnd: { gt: new Date(now.getTime() - 8 * DAY_MS), lte: new Date(now.getTime() + 7 * DAY_MS) } },
          ],
        },
        select: { id: true, storeId: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
        orderBy: { id: "asc" },
        take: limit,
      }),
    );
    if (!claimed.acquired) return { processed: 0 };

    let processed = 0;
    for (const subscription of claimed.value) {
      const due = dueNotice(subscription, now);
      if (!due) continue;
      try {
        // 1) reserva: a linha única decide quem envia (P2002 = outro tick/instância já enviou ou está enviando)
        const reserved = await db.subscriptionNotice
          .create({ data: { subscriptionId: subscription.id, kind: due.kind, dueAt: due.dueAt, sentAt: now } })
          .then(() => true)
          .catch((error: { code?: string }) => {
            if (error.code === "P2002") return false;
            throw error;
          });
        if (!reserved) continue;
        // 2) só o OWNER recebe (STAFF nunca); sem OWNER não há para quem avisar
        const owners = await db.user.findMany({ where: { storeId: subscription.storeId, role: "OWNER" }, select: { email: true } });
        const text = NOTICE_TEXT[due.kind];
        let sent = owners.length > 0;
        for (const owner of owners) sent = (await sendSubscriptionNoticeEmail({ to: owner.email, subject: text.subject, lines: text.lines })) && sent;
        // 3) não saiu: desfaz a reserva para o próximo tick tentar de novo
        if (!sent) {
          await db.subscriptionNotice.deleteMany({ where: { subscriptionId: subscription.id, kind: due.kind, dueAt: due.dueAt } });
          continue;
        }
        processed += 1;
      } catch (error) {
        log.error({ subscriptionId: subscription.id, ...errorTag(error) }, "subscription.notices: falha ao avisar");
      }
    }
    return { processed };
  },
};
