import type { prisma as prismaClient, DeviceAlertCode } from "@meucardapio/db";
import { utc } from "../../lib/sqlTime";
import { DEVICE_ALERT_MONEY_CODES, type WsServerMessage } from "@meucardapio/shared-types";

type Db = typeof prismaClient;

// Janela do dedupe: o mesmo alerta repetido dentro dela só incrementa o contador (uma linha por (loja, código, pedido, janela)).
export const ALERT_WINDOW_MS = 10 * 60 * 1000;
// Retenção: a `tech.cleanup` apaga o que passou do prazo (só tabelas técnicas; nunca dado de negócio).
export const ALERT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Teto de linhas NOVAS por loja por hora: passando disso o alerta só incrementa a linha sem pedido (orderIds inventados não inflam a tabela).
export const ALERT_NEW_ROWS_PER_HOUR = 200;
// Cuid do Prisma: formato fechado conferido ANTES de qualquer consulta.
const CUID = /^c[a-z0-9]{24}$/;

export type RecordInput = { storeId: string; tokenId: string | null; code: DeviceAlertCode; orderId?: string; clientVersion?: string };

export class DeviceAlertService {
  constructor(
    private readonly db: Db,
    private readonly publish: (storeId: string, message: WsServerMessage) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Grava (ou incrementa) o alerta. TELEMETRIA NÃO CONFIÁVEL: nada aqui decide nada além de mostrar um aviso.
  // ANTI-TEMPO: com `orderId` de formato válido a consulta roda SEMPRE e a gravação é a mesma nos dois desfechos; o único efeito de o pedido
  // não ser da loja é o id não ser gravado. A resposta da rota é a mesma (204) em todos os casos.
  async record(input: RecordInput): Promise<{ inserted: boolean; count: number }> {
    const now = this.now();
    let orderId: string | null = null;
    if (input.orderId && CUID.test(input.orderId)) {
      const found = await this.db.order.findFirst({ where: { id: input.orderId, storeId: input.storeId }, select: { id: true } });
      orderId = found ? found.id : null;
    }
    // Teto por loja de linhas novas na última hora (conta as linhas criadas, não os incrementos).
    if (orderId) {
      const recentNew = await this.db.deviceAlert.count({ where: { storeId: input.storeId, firstAt: { gte: new Date(now.getTime() - 3_600_000) } } });
      if (recentNew >= ALERT_NEW_ROWS_PER_HOUR) orderId = null;
    }
    const windowStart = new Date(Math.floor(now.getTime() / ALERT_WINDOW_MS) * ALERT_WINDOW_MS);
    const expiresAt = new Date(now.getTime() + ALERT_RETENTION_MS);
    const orderKey = orderId ?? "";
    // Upsert ATÔMICO: cem alertas iguais simultâneos viram 1 linha com count 100 (sem corrida entre ler e gravar).
    const rows = await this.db.$queryRaw<{ inserted: boolean; count: number }[]>`
      INSERT INTO "DeviceAlert" ("id", "storeId", "tokenId", "code", "orderId", "orderKey", "clientVersion", "count", "windowStart", "firstAt", "lastAt", "expiresAt")
      VALUES ('c' || replace(gen_random_uuid()::text, '-', ''), ${input.storeId}, ${input.tokenId}, ${input.code}::"DeviceAlertCode", ${orderId}, ${orderKey},
              ${input.clientVersion ?? null}, 1, ${utc(windowStart)}, ${utc(now)}, ${utc(now)}, ${utc(expiresAt)})
      ON CONFLICT ("storeId", "code", "orderKey", "windowStart")
      DO UPDATE SET "count" = "DeviceAlert"."count" + 1, "lastAt" = ${utc(now)}, "expiresAt" = ${utc(expiresAt)},
                    "clientVersion" = COALESCE(EXCLUDED."clientVersion", "DeviceAlert"."clientVersion")
      RETURNING (xmax = 0) AS inserted, "count"`;
    const row = rows[0];
    // Só a PRIMEIRA ocorrência da janela acorda o painel; o evento leva só o código.
    if (row.inserted) this.publish(input.storeId, { type: "device.alert", code: input.code });
    return { inserted: row.inserted, count: Number(row.count) };
  }

  // Leitura do dono: código, contagem, quando, versão e o CÓDIGO do pedido (#0123) resolvido aqui; nunca o id interno nem dado do cliente.
  async list(storeId: string) {
    const now = this.now();
    const rows = await this.db.deviceAlert.findMany({
      where: { storeId, lastAt: { gte: new Date(now.getTime() - ALERT_RETENTION_MS) } },
      orderBy: { lastAt: "desc" },
      take: 100,
      select: { id: true, code: true, orderId: true, clientVersion: true, count: true, firstAt: true, lastAt: true },
    });
    const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
    const orders = orderIds.length ? await this.db.order.findMany({ where: { storeId, id: { in: orderIds } }, select: { id: true, code: true } }) : [];
    const codeOf = new Map(orders.map((o) => [o.id, o.code]));
    const alerts = rows.map((r) => ({
      id: r.id,
      code: r.code,
      orderCode: r.orderId ? (codeOf.get(r.orderId) ?? null) : null,
      clientVersion: r.clientVersion,
      count: r.count,
      firstAt: r.firstAt.toISOString(),
      lastAt: r.lastAt.toISOString(),
    }));
    // A FAIXA não pode depender das 100 linhas mais recentes (130 alertas novos de outro código escondiam um `MODE_UNCONFIRMED` ainda válido):
    // o último instante de CADA código sai do banco, de todas as linhas dentro da retenção.
    const maxima = await this.db.deviceAlert.groupBy({ by: ["code"], where: { storeId, lastAt: { gte: new Date(now.getTime() - ALERT_RETENTION_MS) } }, _max: { lastAt: true } });
    const lastByCode = new Map<DeviceAlertCode, Date>();
    for (const g of maxima) if (g._max.lastAt) lastByCode.set(g.code, g._max.lastAt);
    return { alerts, banner: this.banner(lastByCode, now) };
  }

  // Faixa do painel = OU de dois sinais INDEPENDENTES. O `MODE_RECOVERED` do cliente só encerra o `MODE_UNCONFIRMED` do cliente; nunca
  // apaga o `QUEUE_WITHOUT_PRINTER` do detector do servidor (telemetria não confiável não desliga alerta do servidor).
  private banner(lastByCode: Map<DeviceAlertCode, Date>, now: Date) {
    const last = (code: DeviceAlertCode) => lastByCode.get(code) ?? null;
    const unconfirmed = last("MODE_UNCONFIRMED");
    const recovered = last("MODE_RECOVERED");
    const server = last("QUEUE_WITHOUT_PRINTER");
    const money = [...lastByCode].some(([code, lastAt]) => DEVICE_ALERT_MONEY_CODES.includes(code) && now.getTime() - lastAt.getTime() < 24 * 3_600_000);
    return {
      needsAttention: {
        queueWithoutPrinter: !!server && now.getTime() - server.getTime() < ALERT_WINDOW_MS, // o detector re-emite a cada minuto enquanto vale
        modeUnconfirmed: !!unconfirmed && (!recovered || recovered < unconfirmed),
        moneyAlert: money,
      },
    };
  }
}

