// P-4 / RUNBOOK §6 passo (3): recifra TODOS os tokens de pagamento das lojas com a chave ATUAL depois de uma rotação.
// Fica em `src/` (e não em `scripts/`) para ser compilado junto da API: a imagem de produção só tem `dist/`, sem `tsx`.
//   Produção: docker compose exec -T api node dist/cli/reencryptPaymentKeys.js
//   Dev:      pnpm --filter @meucardapio/api exec tsx src/cli/reencryptPaymentKeys.ts
// Usa DATABASE_URL e PAYMENT_ENC_KEY(_ID) / PAYMENT_ENC_KEY_PREV(_ID) do ambiente. Idempotente: pode rodar de novo sem efeito.
// Saída sem segredo (só contagens). Código de saída 1 se alguma conta falhou: NÃO esvazie as chaves PREV nesse caso.
import { prisma } from "@meucardapio/db";
import { currentKey } from "../lib/paymentCrypto";
import { storePaymentsService } from "../modules/storePayments/storePayments.module";

async function main() {
  const { id } = currentKey(); // valida a configuração da chave antes de tocar no banco
  const hasPrev = Boolean(process.env.PAYMENT_ENC_KEY_PREV);
  console.log(`recifrando tokens de pagamento com a chave "${id}"${hasPrev ? "" : " (aviso: PAYMENT_ENC_KEY_PREV vazia; registros na chave antiga vão falhar)"}`);
  const result = await storePaymentsService.reencryptAll(id);
  console.log(`recifrados: ${result.reencrypted} | já na chave atual: ${result.alreadyCurrent} | falhas: ${result.failed}`);
  if (result.failed > 0) {
    console.error("Houve falhas. Mantenha PAYMENT_ENC_KEY_PREV configurada, investigue e rode de novo antes de removê-la.");
    process.exitCode = 1;
  } else {
    console.log("Tudo na chave atual. Já é seguro esvaziar PAYMENT_ENC_KEY_PREV e PAYMENT_ENC_KEY_PREV_ID e fazer o deploy.");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "falha ao recifrar");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
