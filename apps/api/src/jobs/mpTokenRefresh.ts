import { JOB_LOCK_KEYS } from "./lockKeys";
import type { Job } from "./types";
import { storePaymentsService } from "../modules/storePayments/storePayments.module";

// `mp.token.refresh` (ADR-0001 §3.4, ADR-0011): renova o token das lojas a < 30 dias do vencimento e GRAVA o novo
// refresh_token (rotativo). Cada conta é renovada em via única pelo serviço (`FOR UPDATE` na linha), então duas
// instâncias nunca renovam a mesma conta duas vezes; uma conta com falha só é tentada de novo depois de ~20 h, o que faz
// "3 falhas" significar 3 dias e não 3 ticks. Falha NUNCA apaga o token antigo ainda válido; revogação ou 3 falhas seguidas
// ⇒ NEEDS_RECONNECT e aviso ao dono.

export const mpTokenRefreshJob: Job = {
  name: "mp.token.refresh",
  everyMs: 6 * 60 * 60 * 1000, // verifica a cada 6 h; o filtro de 20 h por conta evita insistir
  lockKey: JOB_LOCK_KEYS["mp.token.refresh"],
  limit: 100,
  async runOnce({ now, limit, log }) {
    const due = await storePaymentsService.dueForRefresh(now, limit);
    let processed = 0;
    for (const account of due) {
      const result = await storePaymentsService.refreshAccount(account.id);
      if (result !== "skipped") processed += 1;
      // log sem token e sem vendedor: só o id interno da conta e o resultado
      if (result === "failed" || result === "needs_reconnect") log.warn({ job: "mp.token.refresh", accountId: account.id, result }, "mp.token.refresh.problem");
    }
    return { processed };
  },
};
