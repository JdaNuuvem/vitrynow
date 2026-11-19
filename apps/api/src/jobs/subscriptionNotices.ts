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
      const key = { subscriptionId: subscription.id, kind: due.kind, dueAt: due.dueAt };
      let reserved = false;
      let delivered = false;
      try {
        // 1) reserva: a linha única decide quem envia (P2002 = outro tick/instância já enviou ou está enviando)
        reserved = await db.subscriptionNotice
          .create({ data: { ...key, sentAt: now } })
          .then(() => true)
          .catch((error: { code?: string }) => {
            if (error.code === "P2002") return false;
            throw error;
          });
        if (!reserved) continue;
        // 2) só o OWNER recebe (STAFF nunca); sem OWNER não há para quem avisar
        const owners = await db.user.findMany({ where: { storeId: subscription.storeId, role: "OWNER" }, select: { email: true } });
        const text = NOTICE_TEXT[due.kind];
        // Cada envio isolado: um e-mail que LANÇA (rede, provedor) não pode impedir os outros nem deixar a reserva presa. Basta UM dono ter
        // recebido para o aviso contar como enviado (refazer o ciclo reenviaria ao que já recebeu).
        for (const owner of owners) {
          const ok = await sendSubscriptionNoticeEmail({ to: owner.email, subject: text.subject, lines: text.lines }).catch((error) => {
            log.error({ subscriptionId: subscription.id, ...errorTag(error) }, "subscription.notices: o envio do e-mail lançou");
            return false;
          });
          delivered = ok || delivered;
        }
        if (delivered) processed += 1;
      } catch (error) {
        log.error({ subscriptionId: subscription.id, ...errorTag(error) }, "subscription.notices: falha ao avisar");
      } finally {
        // 3) nada saiu (e-mail recusado, exceção ou falha depois da reserva): DESFAZ a reserva para o próximo ciclo tentar de novo.
        if (reserved && !delivered) {
          await db.subscriptionNotice.deleteMany({ where: key }).catch((error) => log.error({ subscriptionId: subscription.id, ...errorTag(error) }, "subscription.notices: não consegui desfazer a reserva"));
        }
      }
    }
    return { processed };
  },
};
