import { PIX_EXPIRATION_MINUTES, cancelPayment as platformCancel, getPayment as platformGet, mercadoPagoGateway, refundPayment as platformRefund, type PixCharge, type PixChargeInput, type PixGateway, type ProviderPayment } from "../../lib/mercadopago";
import { oauthProvider } from "./oauth";
import { AccountChangedError, NeedsReconnectError, PixUnavailableError } from "./storePayments.service";
import { storePaymentsService } from "./storePayments.module";

// A PORTA que quem cria, consulta, cancela ou estorna PIX de pedido usa (ADR-0001 §3.6): o gateway da LOJA, com o token
// DELA. Mesmas quatro funções de `lib/mercadopago.ts`, mais `accountId` para gravar em `Payment.paymentAccountId`.
//  - `gatewayForStore(storeId)`: para COBRAR. Só com conta CONNECTED; senão `PixUnavailableError` (409 PIX_UNAVAILABLE).
//  - `gatewayForAccount(accountId)`: para CONSULTAR/CANCELAR/ESTORNAR um pagamento que essa conta já criou (webhook,
//    conciliação, estorno): funciona também com a conta pedindo reconexão, enquanto o token ainda vale.
// Nunca cai no token da plataforma.

export type StoreGateway = PixGateway & { readonly accountId: string; readonly storeId: string };

// ───────────── Fake (dev e testes) ─────────────
// Um "provedor" em memória: cada pagamento pertence ao VENDEDOR que o criou; consultar com o gateway de outro vendedor
// é "não encontrado", como o MP faria (e como o critério R4 da Nightingale exige testar).

type FakeEntry = { owner: string; externalReference: string; amountCents: number; status: string; refunds: number };

export class FakePixGateway implements PixGateway {
  private static ledger = new Map<string, FakeEntry>();
  private static keys = new Map<string, string>();
  private static sequence = 0;
  /** Falha injetável (provedor fora do ar) por teste. */
  static failNext: Error | null = null;

  static reset() {
    FakePixGateway.ledger.clear();
    FakePixGateway.keys.clear();
    FakePixGateway.sequence = 0;
    FakePixGateway.failNext = null;
  }
  /** Simula o cliente pagando. */
  static approve(providerPaymentId: string) {
    FakePixGateway.entry(providerPaymentId).status = "approved";
  }
  static setStatus(providerPaymentId: string, status: string) {
    FakePixGateway.entry(providerPaymentId).status = status;
  }
  static peek(providerPaymentId: string) {
    return FakePixGateway.ledger.get(providerPaymentId);
  }
  private static entry(id: string) {
    const entry = FakePixGateway.ledger.get(id);
    if (!entry) throw new Error(`pagamento fake desconhecido: ${id}`);
    return entry;
  }

  constructor(private readonly owner: string) {}

  private guard() {
    const failure = FakePixGateway.failNext;
    if (failure) {
      FakePixGateway.failNext = null;
      throw failure;
    }
  }
  private own(id: string): FakeEntry {
    const entry = FakePixGateway.ledger.get(id);
    if (!entry || entry.owner !== this.owner) throw new Error("payment not found"); // 404 do provedor: não revela de quem é
    return entry;
  }

  async createPixPayment(input: PixChargeInput): Promise<PixCharge> {
    this.guard();
    // idempotência por chave (como o provedor real): repetir devolve o MESMO pagamento, sem segunda cobrança
    const known = input.idempotencyKey ? FakePixGateway.keys.get(`${this.owner}:${input.idempotencyKey}`) : undefined;
    if (known) return this.charge(known);
    FakePixGateway.sequence += 1;
    const id = `fake-pix-${FakePixGateway.sequence}`;
    FakePixGateway.ledger.set(id, { owner: this.owner, externalReference: input.orderId, amountCents: input.amountCents, status: "pending", refunds: 0 });
    if (input.idempotencyKey) FakePixGateway.keys.set(`${this.owner}:${input.idempotencyKey}`, id);
    return this.charge(id);
  }

  private charge(id: string): PixCharge {
    return { providerPaymentId: id, status: FakePixGateway.entry(id).status, pixQrCode: `000201fakepix${id}`, pixQrCodeBase64: "ZmFrZQ==", expiresAt: new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60_000) };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    this.guard();
    const entry = this.own(providerPaymentId);
    return { providerPaymentId, status: entry.status, externalReference: entry.externalReference, amountCents: entry.amountCents, currency: "BRL" };
  }

  async cancelPayment(providerPaymentId: string): Promise<void> {
    this.guard();
    const entry = this.own(providerPaymentId);
    if (entry.status === "pending") entry.status = "cancelled";
  }

  async refundPayment(providerPaymentId: string): Promise<void> {
    this.guard();
    const entry = this.own(providerPaymentId);
    if (entry.status !== "approved" && entry.status !== "refunded") throw new Error("payment not refundable");
    entry.status = "refunded";
    entry.refunds += 1;
  }
}

// ───────────── fábrica ─────────────

type GatewayMaker = (input: { accessToken: string; owner: string }) => PixGateway;

const defaultMaker: GatewayMaker = ({ accessToken, owner }) => (oauthProvider().mode === "fake" ? new FakePixGateway(owner) : mercadoPagoGateway(accessToken));
let maker: GatewayMaker = defaultMaker;
/** Só para testes: troca a fábrica (por exemplo, para conferir qual token chega ao SDK). Sem argumento, restaura. */
export function setGatewayMaker(next?: GatewayMaker) {
  maker = next ?? defaultMaker;
}

function wrap(gateway: PixGateway, accountId: string, storeId: string): StoreGateway {
  return {
    accountId,
    storeId,
    createPixPayment: (input) => gateway.createPixPayment(input),
    getPayment: (id) => gateway.getPayment(id),
    cancelPayment: (id) => gateway.cancelPayment(id),
    refundPayment: (id, key) => gateway.refundPayment(id, key),
  };
}

export async function gatewayForStore(storeId: string): Promise<StoreGateway> {
  const account = await storePaymentsService.accountForCharge(storeId);
  // Quem COBRA é o cliente do cardápio: ele nunca vê "reconecte" (isso é do dono). Sem token válido, o PIX simplesmente não existe.
  const accessToken = await storePaymentsService.accessTokenFor(account).catch((error) => {
    throw error instanceof NeedsReconnectError ? new PixUnavailableError() : error;
  });
  return wrap(maker({ accessToken, owner: account.sellerUserId }), account.id, account.storeId);
}

/**
 * O gateway de um pagamento de PEDIDO JÁ CRIADO (consultar, cancelar, estornar): a conta DA LOJA que o criou
 * (`Payment.paymentAccountId`, conferida contra a loja do pedido). Pagamento anterior à API-07 (`paymentAccountId = null`) foi criado na
 * conta da PLATAFORMA e continua nas funções da plataforma. Conta de outra loja ⇒ `PixUnavailableError`; conta desconectada ⇒ `AccountChangedError`.
 */
export async function gatewayOfPayment(payment: { paymentAccountId: string | null }, storeId: string): Promise<PixGateway> {
  if (!payment.paymentAccountId) {
    return { createPixPayment: () => Promise.reject(new Error("pagamento legado da plataforma não cria cobrança")), getPayment: platformGet, cancelPayment: platformCancel, refundPayment: platformRefund };
  }
  return gatewayForAccount(payment.paymentAccountId, storeId);
}

export async function gatewayForAccount(accountId: string, expectedStoreId: string): Promise<StoreGateway> {
  const account = await storePaymentsService.findAccount(accountId);
  // `Payment.paymentAccountId` não tem FK composta por loja: a conferência é feita aqui. Conta de OUTRA loja = indisponível,
  // sem dizer que ela existe (isolamento entre lojas, ADR-0009).
  if (!account || account.storeId !== expectedStoreId) throw new PixUnavailableError();
  // Pago numa conta que a loja já desconectou/trocou: só sai pelo app do Mercado Pago (RN-B1-16). NUNCA "reconecte".
  if (account.status === "DISCONNECTED") throw new AccountChangedError();
  const accessToken = await storePaymentsService.accessTokenFor(account);
  return wrap(maker({ accessToken, owner: account.sellerUserId }), account.id, account.storeId);
}
