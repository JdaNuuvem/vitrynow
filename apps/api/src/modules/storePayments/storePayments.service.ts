import { createHash, randomBytes } from "node:crypto";
import type { PaymentAccount, PaymentAccountStatus, prisma as prismaClient } from "@meucardapio/db";
import type { AuditLogger } from "../../shared/audit";
import { CodedError } from "../../shared/errors";
import { decryptSecret, encryptSecret } from "../../lib/paymentCrypto";
import { OAuthError, type MercadoPagoOAuth, type OAuthTokens } from "./oauth";

type Db = typeof prismaClient;

const PROVIDER = "mercadopago";
export const STATE_TTL_MS = 10 * 60 * 1000; // o `state` vale 10 minutos e uma vez só
export const REFRESH_BEFORE_MS = 30 * 24 * 60 * 60 * 1000; // renova quando faltam < 30 dias (ADR-0001 §3.4)
export const MAX_REFRESH_FAILURES = 3; // depois disso a conta pede reconexão (NEEDS_RECONNECT) e o dono é avisado
export const REFRESH_RETRY_AFTER_MS = 20 * 60 * 60 * 1000; // no máximo uma tentativa a cada 20 h por conta (conta 1 falha por dia)

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Id do vendedor mascarado para tela e auditoria: nunca o número inteiro. */
export function maskSeller(id: string): string {
  return id.length <= 4 ? "••••" : `${"•".repeat(Math.min(id.length - 4, 6))}${id.slice(-4)}`;
}

export type Actor = { storeId: string; userId: string; sid: string };

/** Erro para o cliente: mensagem curta em português, nunca detalhe do provedor. */
export class PixUnavailableError extends CodedError {
  constructor() {
    super(409, "PIX_UNAVAILABLE", "O PIX não está disponível nesta loja no momento.");
  }
}

export type AccountView = {
  status: PaymentAccountStatus | "NOT_CONNECTED";
  sellerMasked: string | null;
  connectedAt: string | null;
  expiresAt: string | null;
};

// Conta de pagamento da loja (ADR-0001): conectar/desconectar o Mercado Pago, renovar o token e entregar o token CERTO a
// quem cria/consulta/estorna cobranças. Os tokens só existem em memória aqui dentro; resposta, log e auditoria nunca os têm.
export class StorePaymentsService {
  constructor(
    private readonly db: Db,
    private readonly oauth: () => MercadoPagoOAuth,
    private readonly audit: AuditLogger,
    private readonly clock: { now(): Date } = { now: () => new Date() },
    /** Avisa o(s) dono(s) da loja (e-mail). Falha de envio nunca derruba a renovação. */
    private readonly notifyOwner: (storeId: string, event: "needs_reconnect") => Promise<void> = async () => {},
  ) {}

  private ctx(storeId: string, field: string) {
    return { storeId, provider: PROVIDER, field };
  }

  // ───────────── leitura ─────────────

  private async activeAccount(storeId: string): Promise<PaymentAccount | null> {
    return this.db.paymentAccount.findFirst({ where: { storeId, provider: PROVIDER, status: { not: "DISCONNECTED" } } });
  }

  /** Resposta por allowlist: status, vendedor mascarado e datas. Nunca token. */
  async view(storeId: string): Promise<{ mercadopago: AccountView; pixAvailable: boolean }> {
    const account = await this.activeAccount(storeId);
    const mercadopago: AccountView = account
      ? {
          status: account.status,
          sellerMasked: maskSeller(account.sellerUserId),
          connectedAt: account.connectedAt.toISOString(),
          expiresAt: account.expiresAt?.toISOString() ?? null,
        }
      : { status: "NOT_CONNECTED", sellerMasked: null, connectedAt: null, expiresAt: null };
    return { mercadopago, pixAvailable: account?.status === "CONNECTED" };
  }

  /** O cardápio só oferece PIX com conta CONNECTED (decisão D1; condição de G3). */
  async pixAvailable(storeId: string): Promise<boolean> {
    return (await this.activeAccount(storeId))?.status === "CONNECTED";
  }

  // ───────────── conectar ─────────────

  /** Passo 1: gera o `state` (128 bits; só o HASH vai ao banco) e devolve a URL de autorização. */
  async startConnect(actor: Actor, redirectUri: string): Promise<{ authorizationUrl: string }> {
    const state = randomBytes(16).toString("base64url");
    const now = this.clock.now();
    await this.db.paymentOAuthState.deleteMany({ where: { storeId: actor.storeId, OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } });
    await this.db.paymentOAuthState.create({
      data: { storeId: actor.storeId, userId: actor.userId, sid: actor.sid, stateHash: sha256(state), expiresAt: new Date(now.getTime() + STATE_TTL_MS) },
    });
    this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "payment_account.connect_start", targetType: "PaymentAccount" });
    return { authorizationUrl: this.oauth().authorizationUrl({ state, redirectUri }) };
  }

  /**
   * Passo 2 (callback): consome o `state` de forma atômica (uso único), troca o código por tokens e grava CIFRADO. A conta
   * anterior da loja vira DISCONNECTED (sem tokens) e fica no histórico. Falha em qualquer passo: nada ativo é gravado.
   * Lança `CodedError` com códigos estáveis; a rota os transforma em redirecionamento neutro.
   */
  async completeConnect(actor: Actor, input: { code: string; state: string; redirectUri: string }): Promise<AccountView> {
    const now = this.clock.now();
    // Consumo atômico: só passa quem é a mesma loja, o mesmo usuário e a MESMA sessão que iniciou, dentro do prazo, uma vez.
    const consumed = await this.db.paymentOAuthState.updateMany({
      where: { stateHash: sha256(input.state), storeId: actor.storeId, userId: actor.userId, sid: actor.sid, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) throw new CodedError(400, "OAUTH_STATE_INVALID", "Não foi possível concluir a conexão. Tente de novo.");

    let tokens: OAuthTokens;
    try {
      tokens = await this.oauth().exchangeCode({ code: input.code, redirectUri: input.redirectUri });
    } catch (error) {
      const kind = error instanceof OAuthError ? error.kind : "unavailable";
      throw new CodedError(kind === "invalid_code" ? 400 : 502, kind === "invalid_code" ? "OAUTH_CODE_INVALID" : "PAYMENT_PROVIDER_UNAVAILABLE", "Não foi possível conectar o Mercado Pago agora. Tente de novo.");
    }

    const accessTokenEnc = encryptSecret(tokens.accessToken, this.ctx(actor.storeId, "accessToken"));
    const refreshTokenEnc = encryptSecret(tokens.refreshToken, this.ctx(actor.storeId, "refreshToken"));

    try {
      await this.db.$transaction(async (tx) => {
        // Conta anterior: sai de cena SEM tokens (zerados), mas o registro fica (pagamentos antigos apontam para ela).
        await tx.paymentAccount.updateMany({
          where: { storeId: actor.storeId, provider: PROVIDER, status: { not: "DISCONNECTED" } },
          data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null, disconnectedAt: now },
        });
        await tx.paymentAccount.create({
          data: {
            storeId: actor.storeId,
            provider: PROVIDER,
            sellerUserId: tokens.sellerUserId,
            status: "CONNECTED",
            accessTokenEnc,
            refreshTokenEnc,
            expiresAt: tokens.expiresAt,
            connectedAt: now,
          },
        });
      });
    } catch (error) {
      // Índice parcial único: esse vendedor já está ativo em OUTRA loja. Mensagem genérica, sem revelar qual (D1-3).
      if ((error as { code?: string }).code === "P2002") throw new CodedError(409, "PAYMENT_ACCOUNT_IN_USE", "Esta conta do Mercado Pago já está em uso.");
      throw error;
    }
    this.audit.log({
      storeId: actor.storeId,
      userId: actor.userId,
      action: "payment_account.connect",
      targetType: "PaymentAccount",
      metadata: { seller: maskSeller(tokens.sellerUserId), sid: actor.sid },
    });
    return (await this.view(actor.storeId)).mercadopago;
  }

  // ───────────── desconectar ─────────────

  /**
   * Zera os tokens (apaga, não só marca). Bloqueada enquanto houver PIX pago de pedido ainda não encerrado ou estorno
   * pendente (D1-9): senão a loja perderia o acesso ao dinheiro/estorno desses pedidos.
   */
  async disconnect(actor: Actor): Promise<void> {
    const account = await this.activeAccount(actor.storeId);
    if (!account) throw new CodedError(404, "PAYMENT_ACCOUNT_NOT_FOUND", "Não há conta do Mercado Pago conectada.");
    const open = await this.db.payment.count({
      where: {
        paymentAccountId: account.id,
        status: { in: ["APROVADO", "ESTORNO_PENDENTE"] },
        order: { status: { notIn: ["CONCLUIDO", "CANCELADO"] } },
      },
    });
    if (open > 0) {
      throw new CodedError(409, "DISCONNECT_BLOCKED", `Há ${open} pedido(s) com PIX pago ainda em andamento. Conclua ou cancele antes de desconectar.`, { count: open });
    }
    await this.db.paymentAccount.update({
      where: { id: account.id },
      data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null, disconnectedAt: this.clock.now() },
    });
    this.audit.log({
      storeId: actor.storeId,
      userId: actor.userId,
      action: "payment_account.disconnect",
      targetType: "PaymentAccount",
      targetId: account.id,
      metadata: { seller: maskSeller(account.sellerUserId), sid: actor.sid },
    });
  }

  // ───────────── token para quem cria/consulta/estorna cobrança ─────────────

  /** Conta da loja que pode COBRAR agora (CONNECTED) ou `PixUnavailableError`. */
  async accountForCharge(storeId: string): Promise<PaymentAccount> {
    const account = await this.activeAccount(storeId);
    if (!account || account.status !== "CONNECTED" || !account.accessTokenEnc) throw new PixUnavailableError();
    return account;
  }

  /**
   * Token da conta para consultar/estornar um pagamento JÁ CRIADO com ela (mesmo que a conta tenha sido desconectada ou
   * esteja pedindo reconexão: enquanto o token ainda vale, o pagamento segue conciliável). Sem token ⇒ `PixUnavailableError`.
   * NUNCA cai no token da plataforma.
   */
  async accessTokenFor(account: Pick<PaymentAccount, "id" | "storeId" | "accessTokenEnc" | "expiresAt">): Promise<string> {
    if (!account.accessTokenEnc) throw new PixUnavailableError();
    if (account.expiresAt && account.expiresAt <= this.clock.now()) throw new PixUnavailableError();
    return decryptSecret(account.accessTokenEnc, this.ctx(account.storeId, "accessToken"));
  }

  async findAccount(accountId: string): Promise<PaymentAccount | null> {
    return this.db.paymentAccount.findUnique({ where: { id: accountId } });
  }

  // ───────────── renovação (job mp.token.refresh) ─────────────

  /** Contas ativas cujo token vence em menos de 30 dias. */
  dueForRefresh(now: Date, limit: number): Promise<PaymentAccount[]> {
    return this.db.paymentAccount.findMany({
      where: {
        provider: PROVIDER,
        status: "CONNECTED",
        expiresAt: { lt: new Date(now.getTime() + REFRESH_BEFORE_MS) },
        OR: [{ lastRefreshAttemptAt: null }, { lastRefreshAttemptAt: { lt: new Date(now.getTime() - REFRESH_RETRY_AFTER_MS) } }],
      },
      orderBy: { expiresAt: "asc" },
      take: limit,
    });
  }

  /**
   * Renova UMA conta em via única (D1-4): trava a linha, troca o refresh_token ROTATIVO e grava o par novo na mesma
   * transação ANTES de qualquer uso. Falha não apaga o token antigo ainda válido; depois de N falhas seguidas a conta
   * vira NEEDS_RECONNECT e o dono é avisado. Devolve o que aconteceu (sem segredo).
   */
  async refreshAccount(accountId: string): Promise<"refreshed" | "skipped" | "failed" | "needs_reconnect"> {
    const outcome = await this.refreshLocked(accountId);
    if (outcome.result === "needs_reconnect") {
      // fora da transação e sem derrubar nada: o aviso é do dono, a conta já está marcada
      await this.notifyOwner(outcome.storeId, "needs_reconnect").catch(() => undefined);
    }
    return outcome.result;
  }

  private async refreshLocked(accountId: string): Promise<{ result: "refreshed" | "skipped" | "failed" | "needs_reconnect"; storeId: string }> {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PaymentAccount" WHERE "id" = ${accountId} FOR UPDATE`;
      if (rows.length === 0) return { result: "skipped" as const, storeId: "" };
      const account = await tx.paymentAccount.findUniqueOrThrow({ where: { id: accountId } });
      const now = this.clock.now();
      // Outra via já renovou (ou a conta saiu de cena) enquanto esperávamos a trava.
      if (account.status !== "CONNECTED" || !account.refreshTokenEnc) return { result: "skipped" as const, storeId: account.storeId };
      if (account.expiresAt && account.expiresAt.getTime() - now.getTime() >= REFRESH_BEFORE_MS) return { result: "skipped" as const, storeId: account.storeId };

      try {
        const current = decryptSecret(account.refreshTokenEnc, this.ctx(account.storeId, "refreshToken"));
        const tokens = await this.oauth().refresh(current);
        if (tokens.sellerUserId !== account.sellerUserId) throw new OAuthError("vendedor diferente", "revoked");
        await tx.paymentAccount.update({
          where: { id: accountId },
          data: {
            accessTokenEnc: encryptSecret(tokens.accessToken, this.ctx(account.storeId, "accessToken")),
            refreshTokenEnc: encryptSecret(tokens.refreshToken, this.ctx(account.storeId, "refreshToken")),
            expiresAt: tokens.expiresAt,
            lastRefreshAt: now,
            lastRefreshAttemptAt: now,
            refreshFailures: 0,
            lastError: null,
          },
        });
        return { result: "refreshed" as const, storeId: account.storeId };
      } catch (error) {
        const revoked = error instanceof OAuthError && error.kind === "revoked";
        const failures = account.refreshFailures + 1;
        const giveUp = revoked || failures >= MAX_REFRESH_FAILURES;
        await tx.paymentAccount.update({
          where: { id: accountId },
          data: {
            refreshFailures: failures,
            lastRefreshAttemptAt: now,
            // texto curto e fixo: nunca a mensagem do cliente HTTP (poderia carregar token)
            lastError: revoked ? "vínculo revogado pelo provedor" : "falha ao renovar o token",
            ...(giveUp ? { status: "NEEDS_RECONNECT" as const } : {}),
          },
        });
        if (giveUp) {
          this.audit.log({
            storeId: account.storeId,
            action: "payment_account.needs_reconnect",
            targetType: "PaymentAccount",
            targetId: accountId,
            metadata: { seller: maskSeller(account.sellerUserId), failures },
          });
          return { result: "needs_reconnect" as const, storeId: account.storeId };
        }
        return { result: "failed" as const, storeId: account.storeId };
      }
    }, { maxWait: 15_000, timeout: 30_000 }); // quem espera a trava da conta segura uma conexão; a chamada ao provedor tem prazo próprio (10 s)
  }
}
