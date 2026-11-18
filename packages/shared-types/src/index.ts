import { z } from "zod";
import { textField } from "./text";
export * from "./text";

// Telefone tolerante (BR ou genérico): dígitos, espaços, parênteses, hífen, "+", 8-20 chars.
// Não valida DDD/formato exato — só rejeita lixo claramente não-telefone.
export const phoneSchema = z
  .string()
  .trim()
  .min(8)
  .max(20)
  .regex(/^[0-9+()\s-]+$/, "telefone inválido");

export const orderTypeSchema = z.enum(["MESA", "DELIVERY", "BALCAO"]);
export const orderStatusSchema = z.enum([
  "PENDENTE",
  "CONFIRMADO",
  "EM_PREPARO",
  "PRONTO",
  "SAIU_PARA_ENTREGA",
  "CONCLUIDO",
  "CANCELADO",
]);

export const createOrderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(100),
  notes: textField({ max: 150, multiline: true }).optional(), // RN-TXT-02: observação do item
  additionalIds: z.array(z.string().min(1)).max(50).optional(),
});

// "CARTAO" é o valor legado do checkout antigo e vale como CREDITO.
export const paymentMethodSchema = z.enum(["PIX", "DINHEIRO", "CARTAO", "CREDITO", "DEBITO", "VR", "VA"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const createOrderSchema = z.object({
  type: orderTypeSchema,
  customerName: textField({ max: 80, min: 1 }).optional(),
  customerPhone: phoneSchema.optional(),
  address: textField({ max: 280, multiline: true }).optional(), // rua+número 200 e complemento 80 (RN-TXT-02)
  notes: textField({ max: 300, multiline: true }).optional(), // observação do pedido
  items: z.array(createOrderItemSchema).min(1).max(100),
  couponCode: z.string().min(1).max(50).optional(),
  paymentMethod: paymentMethodSchema.optional(),
  changeForCents: z.number().int().positive().max(100_000_000).optional(),
  tipCents: z.number().int().nonnegative().max(10_000_000).optional(),
  neighborhoodId: z.string().min(1).max(50).optional(), // API-16: bairro escolhido (só entrega)
  expectedDeliveryFeeCents: z.number().int().nonnegative().max(10_000_000).optional(), // taxa que o cliente viu (RN-B9-03)
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// API-22 — mesa e pedido pelo QR (ADR-0002 nível 1). O cliente não manda preço, telefone nem forma de pagamento: paga ao receber a mesa (API-24).
export const createTableOrderSchema = z.object({
  customerName: z.string().trim().min(1).max(60).optional(),
  notes: z.string().max(500).optional(),
  items: z.array(createOrderItemSchema).min(1).max(100),
});
export type CreateTableOrderInput = z.infer<typeof createTableOrderSchema>;
export const tableLabelSchema = z.string().trim().min(1).max(40);
export const createTableSchema = z.object({ label: tableLabelSchema, position: z.number().int().min(0).max(10_000).optional() });
export const updateTableSchema = z.object({ label: tableLabelSchema.optional(), active: z.boolean().optional(), position: z.number().int().min(0).max(10_000).optional() }).refine((v) => Object.keys(v).length > 0, "nada para alterar");
export const qrSettingsSchema = z.object({
  qrOrderingEnabled: z.boolean().optional(),
  qrOrdersNeedApproval: z.boolean().optional(),
  confirmNoApproval: z.boolean().optional(), // RN-MB-01: desligar o aceite exige confirmar o aviso
}).refine((v) => v.qrOrderingEnabled !== undefined || v.qrOrdersNeedApproval !== undefined, "nada para alterar");

// API-24 — receber a mesa (BASICO: UMA forma de pagamento, sem taxa de serviço, desconto nem divisão; RN-MB-03). O servidor soma a conta; o total do cliente só confere.
export const receiveTableSchema = z.object({
  paymentMethod: paymentMethodSchema,
  changeForCents: z.number().int().positive().max(100_000_000).optional(), // dinheiro: "troco para"
  expectedTotalCents: z.number().int().positive().max(1_000_000_000).optional(), // o que a tela mostrava: se a conta mudou, 409 TOTAL_CHANGED
}).strict();
export type ReceiveTableInput = z.infer<typeof receiveTableSchema>;

// API-13 — pedido lançado no PAINEL (atendente). O servidor calcula todo preço (RN-B2-01); a tela manda só ids e quantidades. Sem MESA no BASICO (RN-B2-13).
export const MANUAL_DISCOUNT_REASONS = ["CORTESIA", "ERRO_DO_PEDIDO", "CLIENTE_FREQUENTE", "PROMOCAO_DO_DIA", "OUTRO"] as const;
export const manualOrderChannelSchema = z.enum(["TELEFONE", "WHATSAPP", "BALCAO", "OUTRO"]);
export const createManualOrderSchema = z.object({
  type: z.enum(["DELIVERY", "BALCAO"]),
  customerName: z.string().trim().min(1).max(150).optional(),
  customerPhone: phoneSchema.optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
  items: z.array(createOrderItemSchema).min(1).max(100),
  couponCode: z.string().min(1).max(50).optional(),
  forceCoupon: z.boolean().optional(), // só OWNER: aceita cupom esgotado (RN-B2-05)
  paymentMethod: paymentMethodSchema.optional(),
  alreadyPaid: z.boolean().optional(), // "já pago": o dinheiro foi recebido agora (em dinheiro exige caixa aberto, RN-B2-07)
  changeForCents: z.number().int().positive().max(100_000_000).optional(),
  tipCents: z.number().int().nonnegative().max(10_000_000).optional(),
  discount: z.object({ percent: z.number().int().min(1).max(100), reason: z.enum(MANUAL_DISCOUNT_REASONS) }).optional(), // RN-B2-06: motivo em LISTA FECHADA (sem texto livre: o atendente poderia digitar dado do cliente)
  channel: manualOrderChannelSchema.optional(),
});
export type CreateManualOrderInput = z.infer<typeof createManualOrderSchema>;

// ST-34: e-mail sempre normalizado na entrada (sem espaços nas pontas e em minúsculas), para "VITIMA@x" e
// "vitima@x" nunca virarem duas contas. Vale para login, cadastro, convite e esqueci-a-senha.
export const emailField = z.string().trim().toLowerCase().email().max(200);

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// SEC-29: senha nova com no mínimo 10 caracteres, SEM exigir composição (maiúscula, número, símbolo): comprimento vale mais que regra de
// composição e a pessoa usa uma frase. Vale para cadastro, convite de equipe, troca e redefinição. O LOGIN não tem mínimo: contas antigas
// (com 6 a 9 caracteres) continuam entrando, e a troca delas é voluntária.
export const MIN_PASSWORD_LENGTH = 10;
export const PASSWORD_TOO_SHORT_MESSAGE = "A senha precisa ter pelo menos 10 caracteres.";
const newPasswordField = z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT_MESSAGE).max(200);

export const createStaffUserSchema = z.object({
  email: emailField,
  password: newPasswordField,
  role: z.enum(["OWNER", "STAFF"]).optional(),
});
export type CreateStaffUserInput = z.infer<typeof createStaffUserSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: newPasswordField,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// SEC-29 (ST-67): além do token, quem redefine DIGITA o e-mail da conta; o servidor o compara com o da conta do token. Sem isto, o link da
// conta de um atacante, mandado à vítima, redefineria a conta DELE com a senha que a vítima reutiliza.
export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(200),
  email: emailField,
  newPassword: newPasswordField,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// SEC-29 (ST-63): a página de redefinição pergunta DE QUAL CONTA é o token antes de a pessoa digitar a senha nova. Não consome o token.
export const inspectResetTokenSchema = z.object({ token: z.string().min(1).max(512) });
export type InspectResetTokenInput = z.infer<typeof inspectResetTokenSchema>;

export const registerStoreSchema = z.object({
  storeName: textField({ max: 150, min: 1 }),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "use apenas letras minúsculas, números e hífen"),
  code: z.string().min(1).max(30).optional(), // RN-ONB-01: não é pedido ao usuário; o servidor gera quando ausente
  email: emailField,
  password: newPasswordField,
});
export type RegisterStoreInput = z.infer<typeof registerStoreSchema>;

// Mensagens trocadas no canal WS do print-client (um canal por loja, autenticado por device token).
export const wsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("order.created"), orderId: z.string() }),
  z.object({ type: z.literal("order.updated"), orderId: z.string() }),
  z.object({ type: z.literal("order.cancel_notice"), orderId: z.string() }),
  z.object({ type: z.literal("payment.refund_pending"), orderId: z.string() }),
  z.object({ type: z.literal("payment.refund_done"), orderId: z.string() }),
  // API-69 (RN-REF-01): o estorno cruzou o teto de tentativas automáticas. SÓ o id do pedido (sem valor, regra do canal); sai UMA vez.
  z.object({ type: z.literal("payment.refund_stuck"), orderId: z.string() }),
  z.object({ type: z.literal("payment.reconcile_needed"), orderId: z.string() }),
  // Fila de impressão (ADR-0004): só "acorde e peça job"; nenhum dado de pedido ou cliente no canal.
  z.object({ type: z.literal("print.available") }),
  // N8: eventos do PAINEL (só ids, contagens e código fechado; nenhum dado de pedido, cliente ou texto livre). O device NÃO os recebe (hub.publishToPanel).
  z.object({ type: z.literal("print.job_failed"), jobId: z.string(), code: z.enum(["PRINTER_OFFLINE", "NO_PAPER", "DRIVER_ERROR", "PRINTER_NOT_FOUND", "OTHER"]).optional() }),
  z.object({ type: z.literal("print.claimed"), jobId: z.string() }),
  z.object({ type: z.literal("print.printed"), jobId: z.string(), orderId: z.string().optional() }),
  z.object({ type: z.literal("print.stale"), count: z.number().int().positive() }),
  // Caixa (CA-CX-28): o STAFF fechou com diferença ACIMA da tolerância. SÓ o id do caixa (sem valor, papel nem motivo; o dono busca o detalhe na tela do caixa fechado). Entregue só a conexões de OWNER (realtime/hub.ts).
  z.object({ type: z.literal("cashier.difference_over_tolerance"), sessionId: z.string() }),
  // PC-24: alerta de dispositivo para o painel do dono. Só o CÓDIGO (a frase sai do código no painel); nada de pedido, cliente ou texto livre.
  z.object({ type: z.literal("device.alert"), code: z.string() }),
  // API-22 (mesa): chamar garçom / pedir a conta / rajada de pedidos do QR. Só ids e o tipo; nada de dado do cliente. Painel (ADR-0002 D2-5).
  z.object({ type: z.literal("table.alert"), tableId: z.string(), kind: z.enum(["CALL_WAITER", "ASK_BILL", "BURST"]) }),
  z.object({ type: z.literal("ping") }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

// API-47 / ADR-0009 §2: CADA tipo declara a audiência. `device` (print-client) recebe SÓ `print.available` e `ping`; o resto é do painel.
// Record completo: tipo novo sem audiência não compila (e o teste de contrato confere o runtime).
export type WsAudience = "panel" | "device" | "both";
export const WS_AUDIENCE: Record<WsServerMessage["type"], WsAudience> = {
  "order.created": "panel",
  "order.updated": "panel",
  "order.cancel_notice": "panel",
  "payment.refund_pending": "panel",
  "payment.refund_done": "panel",
  "payment.refund_stuck": "panel", // API-69 x API-47 (lote 1): so orderId; o hub o entrega SO ao OWNER (OWNER_ONLY_TYPES)
  "table.alert": "panel", // API-22 x API-47 (lote 2): chamar atendente/pedir conta; sem dado pessoal; so o painel (nunca o aparelho)
  "payment.reconcile_needed": "panel",
  "print.available": "both",
  "print.job_failed": "panel",
  "print.claimed": "panel",
  "print.printed": "panel",
  "print.stale": "panel",
  "cashier.difference_over_tolerance": "panel",
  "device.alert": "panel",
  ping: "both",
};

// PC-24: alertas que o CLIENTE de impressão pode mandar (lista FECHADA). `QUEUE_WITHOUT_PRINTER` é só do servidor: o cliente nunca o envia.
export const DEVICE_ALERT_CLIENT_CODES = [
  "NOTHING_TO_CHARGE_CONFLICT",
  "NOTHING_TO_CHARGE_INVALID",
  "EMPTY_ZERO_TICKET",
  "MODE_UNCONFIRMED",
  "MODE_RECOVERED",
] as const;
// Alertas de DINHEIRO (regra de não cobrar / total zero): o aviso em tempo real vai SÓ ao OWNER (decisão do Leonardo e do Atlas); o hub aplica o filtro.
export const DEVICE_ALERT_MONEY_CODES: readonly string[] = ["NOTHING_TO_CHARGE_CONFLICT", "NOTHING_TO_CHARGE_INVALID", "EMPTY_ZERO_TICKET"];
// Corpo ESTRITO: chave desconhecida é recusada (nenhum texto livre cabe aqui). `orderId` é frouxo de propósito (o formato é conferido no
// serviço, que NÃO recusa: grava sem o id e responde igual); `clientVersion` só com a lista curta de caracteres.
export const deviceAlertBodySchema = z
  .object({
    code: z.enum(DEVICE_ALERT_CLIENT_CODES),
    orderId: z.string().max(64).optional(),
    clientVersion: z.string().regex(/^[0-9A-Za-z._-]{1,20}$/).optional(),
  })
  .strict();
export type DeviceAlertBody = z.infer<typeof deviceAlertBodySchema>;

// Tíquete pronto para impressão — contrato entre API e print-client (equivalente ao
// textSaleNew do original, mas como JSON estruturado em vez de HTML pronto para GDI+).
export const orderPaymentMethodSchema = z.enum(["DINHEIRO", "PIX", "CREDITO", "DEBITO", "VR", "VA"]);
export type OrderPaymentMethod = z.infer<typeof orderPaymentMethodSchema>;

// Contrato do tíquete (ADR-0004 §6/§7). `PAGO` é a ÚNICA prova de "NÃO COBRAR": só a API emite, e só com pagamento
// aprovado e verificado (webhook com valor/referência conferidos). Nenhum token, QR, e-mail nem id do provedor aqui.
export const ticketPaymentStatusSchema = z.enum(["PAGO", "A_COBRAR", "ESTORNADO"]);
export type TicketPaymentStatus = z.infer<typeof ticketPaymentStatusSchema>;
export const TICKET_SCHEMA_VERSION = 4; // 4 = mesa: `tableLabel`, `round` e `requestedBy` preenchidos (API-23); 1 = contrato anterior (sem os campos do B4); 2 = B4; 3 = `nothingToCharge` (API-66). O print-client antigo ignora o que não conhece

export const printableOrderSchema = z.object({
  orderId: z.string(),
  code: z.string(),
  type: orderTypeSchema,
  storeName: z.string(),
  customerName: z.string().nullable(),
  customerPhone: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  totalCents: z.number().int(),
  deliveryFeeCents: z.number().int(),
  tipCents: z.number().int(),
  paymentMethod: orderPaymentMethodSchema.nullable(),
  createdAt: z.string(),
  // ---- B4 (API-14) ----
  ticketSchemaVersion: z.number().int().optional(),
  paymentStatus: ticketPaymentStatusSchema.optional(),
  tableLabel: z.string().nullable().optional(), // "Mesa 12" (API-22/23); só em pedido de mesa
  round: z.number().int().positive().nullable().optional(), // API-23: nº da rodada da mesa (1, 2, 3...) desde o último recebimento; só em pedido de mesa
  requestedBy: z.string().nullable().optional(), // API-23: quem pediu — o nome informado ou "Aparelho N" (N = ordem do aparelho na mesa); nunca o token
  subtotalCents: z.number().int().optional(),
  discountCents: z.number().int().optional(),
  couponCode: z.string().nullable().optional(),
  changeForCents: z.number().int().nullable().optional(),
  reprintCount: z.number().int().nonnegative().optional(),
  printedAtOriginal: z.string().nullable().optional(), // ISO UTC, só na 2ª via
  cancelNotice: z.boolean().optional(), // true = imprime o aviso de cancelamento (sem itens/valores/endereço)
  // API-66: o SERVIDOR diz se não há nada a cobrar (fonte única; o cliente não decide sozinho). true só com total = 0 E nenhuma cobrança possível
  // (sem pagamento aprovado, pendente ou estornado). Em pedido real nunca sai ausente; no aviso de cancelamento e no teste é false.
  nothingToCharge: z.boolean().optional(),
  items: z.array(
    z.object({
      productName: z.string(),
      quantity: z.number().int(),
      unitPriceCents: z.number().int(),
      notes: z.string().nullable(),
      additionals: z.array(z.object({ name: z.string(), priceCents: z.number().int() })),
    }),
  ),
});
export type PrintableOrder = z.infer<typeof printableOrderSchema>;

// ---- Catálogo (painel) ----

export const createCategorySchema = z.object({
  name: textField({ max: 50, min: 1 }),
  icon: z.string().max(8).optional().or(z.literal("")),
  position: z.number().int().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const productAdditionalInputSchema = z.object({
  id: z.string().optional(), // presente ao editar um adicional existente
  name: textField({ max: 60, min: 1 }),
  priceCents: z.number().int().nonnegative().max(100_000_000),
});

// SEC-14 (ST-18): domínio próprio da loja = NOME DE HOST puro, em minúsculas (sem esquema, porta, caminho, espaço, IP nem 'localhost'). Quando o roteamento
// por domínio existir, `customDomain` decide de qual loja é a requisição: texto livre e repetido permitiria uma loja tomar o domínio de outra.
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
export const customDomainSchema = z
  .string()
  .transform((v) => v.trim().toLowerCase().replace(/\.$/, ""))
  .pipe(
    z
      .string()
      .max(253, "domínio longo demais")
      .refine((host) => {
        const labels = host.split(".");
        if (labels.length < 2 || !labels.every((label) => HOST_LABEL.test(label))) return false;
        if (/^\d+$/.test(labels[labels.length - 1])) return false; // 1.2.3.4 e afins: IP não é domínio
        return /^[a-z]{2,63}$|^xn--[a-z0-9-]{1,59}$/.test(labels[labels.length - 1]);
      }, "use só o nome do domínio, ex. cardapio.minhaloja.com.br (sem http://, porta ou caminho)"),
  );

// ST-17 / NG-07: URL de imagem só em https, sem usuário/senha e sem esquema estranho (javascript:, data:, file:, http:).
// O CSP do web (img-src) já recusa http:// no navegador; recusar aqui dá ao lojista a mensagem na hora em vez de
// uma foto que some sozinha. Até o upload próprio (B12), o lojista cola uma URL https.
export const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      // Prefixo literal "https://": "https:host/x" o parser aceita, mas o navegador o trata como relativo.
      if (!/^https:\/\//i.test(value)) return false;
      try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "";
      } catch {
        return false;
      }
    },
    { message: "use um endereço que comece com https://" },
  );

export const createProductSchema = z.object({
  categoryId: z.string().min(1), // obrigatório (RN-CT-07, API-56): produto sem categoria nunca aparece na vitrine
  name: textField({ max: 80, min: 1 }), // API-49: sanitiza e limita (o 150 era o limite antigo, anterior a API-49)
  description: textField({ max: 300, multiline: true }).optional(),
  imageUrl: z.string().url().max(500).optional().or(z.literal("")),
  categoryId: z.string().min(1).optional(),
  name: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  imageUrl: httpsUrl.optional().or(z.literal("")),
  priceCents: z.number().int().nonnegative().max(100_000_000),
  active: z.boolean().optional(),
  // `featured` não é aceito: a coluna existe, mas nenhuma tela a usa (RN-CT-14).
  position: z.number().int().optional(),
  additionals: z.array(productAdditionalInputSchema).max(50).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();

export const moveProductsSchema = z.object({ toCategoryId: z.string().min(1) });
export const reorderCategoriesSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) });
export const reorderProductsSchema = z.object({ categoryId: z.string().min(1), ids: z.array(z.string().min(1)).min(1).max(1000) });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ---- Esgotado hoje (API-17 / B11) ----
export const SOLD_OUT_DURATIONS = ["TODAY", "MANUAL"] as const; // até o fim de hoje (padrão) | até eu reativar
export const setSoldOutSchema = z.object({
  soldOut: z.boolean(),
  duration: z.enum(SOLD_OUT_DURATIONS).optional(),
});
export type SetSoldOutInput = z.infer<typeof setSoldOutSchema>;

// ---- Histórico de pedidos e observação interna (API-54) ----
export const HISTORY_PERIODS = ["today", "yesterday", "7d", "30d", "custom"] as const;
export const HISTORY_STATUS_FILTERS = ["ALL", "ABERTO", "CONCLUIDO", "CANCELADO", "AGUARDANDO_PAGAMENTO", "PAGAMENTO_EXPIRADO"] as const;
export const orderHistoryQuerySchema = z.object({
  q: z.string().max(100).optional(),
  period: z.enum(HISTORY_PERIODS).optional(),
  from: z.string().max(10).optional(), // AAAA-MM-DD no fuso da loja (period=custom)
  to: z.string().max(10).optional(),
  status: z.enum(HISTORY_STATUS_FILTERS).optional(),
  type: orderTypeSchema.optional(),
  paymentMethod: z.string().max(20).optional(),
  refundPending: z.enum(["true", "false"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export const orderInternalNoteSchema = z.object({ note: textField({ max: 500, multiline: true }).nullable() });
// ---- Grupos de opções (B8) ----
// Regras de negócio (mínimo/máximo coerentes, BASE = 1..1, limites) ficam na API (optionGroups.domain); aqui só o formato.

export const optionInputSchema = z.object({
  id: z.string().min(1).optional(), // presente ao editar uma opção existente
  name: z.string().trim().min(1).max(150),
  priceCents: z.number().int().min(0).max(100_000_000),
  active: z.boolean().optional(),
});

export const optionGroupInputSchema = z.object({
  name: z.string().trim().min(1).max(150),
  helpText: z.string().trim().max(300).nullish().transform((v) => (v ? v : null)),
  minSelect: z.number().int().min(0).max(100).default(0),
  maxSelect: z.number().int().min(1).max(100).nullable().default(1), // null = sem limite
  maxPerOption: z.number().int().min(1).max(99).default(1),
  priceMode: z.enum(["SUM", "BASE"]).default("SUM"),
  options: z.array(optionInputSchema).max(60),
});
export type OptionGroupInput = z.infer<typeof optionGroupInputSchema>;

export const productOptionGroupsSchema = z.object({ groupIds: z.array(z.string().min(1)).max(50) });

// ---- Caixa (painel) ----

export const openCashSessionSchema = z.object({
  openingBalanceCents: z.number().int().nonnegative().max(100_000_000), // teto da RN-CX-12 (R$ 1.000.000,00)
  notes: textField({ max: 300, multiline: true }).optional(),
});
export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;

// `closingBalanceCents` ausente/nulo NUNCA vira 0 por omissão: o servidor responde 400 CASH_COUNTED_REQUIRED (zero digitado de propósito vale).
// `reason`/`reasonText` são validados pelo servidor contra a lista fechada (CASH_REASON_REQUIRED / CASH_REASON_INVALID).
export const closeCashSessionSchema = z.object({
  closingBalanceCents: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
  notes: textField({ max: 300, multiline: true }).optional(),
  reason: z.string().max(40).nullable().optional(),
  reasonText: textField({ max: 400 }).nullable().optional(), // limpa aqui; o limite de 200 do motivo OUTRO é regra do servidor (CASH_REASON_INVALID, API-27)
});
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;

export const cashMovementTypeSchema = z.enum(["SUPRIMENTO", "SANGRIA"]);

// Motivo OBRIGATÓRIO em toda movimentação (RN-CX-07): o servidor valida `reason` contra a lista do TIPO; `notes` NÃO substitui `reason`.
export const createCashMovementSchema = z.object({
  type: cashMovementTypeSchema,
  amountCents: z.number().int().positive().max(100_000_000),
  notes: textField({ max: 300, multiline: true }).optional(),
  reason: z.string().max(40).nullable().optional(),
  reasonText: textField({ max: 400 }).nullable().optional(), // limpa aqui; o limite de 200 do motivo OUTRO é regra do servidor (CASH_REASON_INVALID, API-27)
});
export const setCashStaffLimitSchema = z.object({ limitCents: z.number().int().nonnegative().max(100_000_000) });
export type CreateCashMovementInput = z.infer<typeof createCashMovementSchema>;

// ---- Cupons (painel + storefront) ----

export const couponDiscountTypeSchema = z.enum(["PERCENT", "FIXED"]);

export const createCouponSchema = z.object({
  // RN-CP-08: 3 a 20 caracteres, só letras sem acento, números, hífen e sublinhado; guardado em maiúsculas.
  code: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9_-]{3,20}$/, "use de 3 a 20 caracteres: letras sem acento, números, hífen ou sublinhado")),
  discountType: couponDiscountTypeSchema,
  discountValue: z.number().int().positive().max(100_000_000),
  active: z.boolean().optional(),
  maxUses: z.number().int().positive().optional(),
  minOrderCents: z.number().int().nonnegative().max(100_000_000).optional(),
  // Validade: "AAAA-MM-DD" (vale até 23:59 desse dia, no fuso da loja) ou um instante ISO. Que não seja passado é regra do servidor.
  expiresAt: z
    .string()
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)), "data inválida")
    .optional(),
});
export type CreateCouponInput = z.infer<typeof createCouponSchema>;

export const updateCouponSchema = createCouponSchema.partial();
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

// ---- Conta / personalização da loja ----

export const updateStoreSettingsSchema = z.object({
  name: textField({ max: 150, min: 1 }).optional(),
  logoUrl: z.string().url().max(500).optional().or(z.literal("")),
  coverImageUrl: z.string().url().max(500).optional().or(z.literal("")),
  name: z.string().min(1).max(150).optional(),
  logoUrl: httpsUrl.optional().or(z.literal("")),
  coverImageUrl: httpsUrl.optional().or(z.literal("")),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "use um hex de cor, ex. #16a34a")
    .optional()
    .or(z.literal("")),
  customDomain: z.string().max(200).optional().or(z.literal("")),
  address: textField({ max: 300, multiline: true }).optional(),
  customDomain: customDomainSchema.optional().or(z.literal("")),
  address: z.string().max(300).optional().or(z.literal("")),
  whatsapp: z
    .string()
    .regex(/^[0-9]{10,15}$/, "use só números com DDI, ex. 5521999999999")
    .optional()
    .or(z.literal("")),
  openingHours: textField({ max: 200 }).optional(),
  minOrderCents: z.number().int().nonnegative().max(100_000_000).optional(),
  deliveryEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  hideSoldOutProducts: z.boolean().optional(),
  deliveryFeeCents: z.number().int().nonnegative().max(10_000_000).optional(),
});
export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;

// ---- Entregadores ----

export const createDelivererSchema = z.object({
  name: textField({ max: 80, min: 1 }),
  phone: phoneSchema.optional(),
});
export type CreateDelivererInput = z.infer<typeof createDelivererSchema>;

export const updateDelivererSchema = createDelivererSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateDelivererInput = z.infer<typeof updateDelivererSchema>;

export const assignDelivererSchema = z.object({
  delivererId: z.string().min(1).nullable(),
});
export type AssignDelivererInput = z.infer<typeof assignDelivererSchema>;

// ---- Chaves de impressora (device tokens) ----

export const createDeviceTokenSchema = z.object({
  label: z.string().max(100).optional(),
});
export type CreateDeviceTokenInput = z.infer<typeof createDeviceTokenSchema>;

// ---- Feedback do painel ----

export const createFeedbackSchema = z.object({
  message: textField({ max: 2000, min: 1, multiline: true }),
});
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

// ---- Loja disponível/fechada ----

export const storeAvailabilitySchema = z.object({ acceptingOrders: z.boolean() });
export type StoreAvailabilityInput = z.infer<typeof storeAvailabilitySchema>;

// ---- Horário de funcionamento (B5) ----
// Dia 0 = domingo (como Date#getDay). "24:00" só vale como fim. Validações de sobreposição ficam na API.

const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM");
const hhmmEndSchema = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, "use HH:MM");
export const scheduleIntervalSchema = z.object({ start: hhmmSchema, end: hhmmEndSchema });
export const storeScheduleSchema = z.object({
  week: z.array(z.array(scheduleIntervalSchema).max(6)).length(7),
  exceptions: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD"),
        closed: z.boolean(),
        intervals: z.array(scheduleIntervalSchema).max(6).optional(),
      }),
    )
    .max(200)
    .default([]),
  cutoffMinutes: z.number().int().min(0).max(240).default(0),
});
export type StoreScheduleInput = z.infer<typeof storeScheduleSchema>;
export const updateStoreHoursSchema = z.object({ schedule: storeScheduleSchema.nullable() });
export const storeStatusActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PAUSE"), minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]) }),
  z.object({ action: z.literal("CLOSE_TODAY") }),
  z.object({ action: z.literal("RESUME") }),
]);
export type StoreStatusAction = z.infer<typeof storeStatusActionSchema>;

// ---- Planos e assinatura ----

export const checkoutPlanSchema = z.object({ planCode: z.string().min(1).max(50) });
export type CheckoutPlanInput = z.infer<typeof checkoutPlanSchema>;

// ---- Avisos da plataforma ----

export const createNoticeSchema = z.object({
  title: textField({ max: 150, min: 1 }),
  body: textField({ max: 2000, min: 1, multiline: true }),
  imageUrl: z.string().url().max(500).optional(),
  title: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(2000),
  imageUrl: httpsUrl.optional(),
  expiresAt: z.string().datetime().optional(),
});
export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;

// ---- Confirmação de segurança (MFA por e-mail) ----

// SEC-13: ações irreversíveis ou de controle de acesso. Cada uma exige um código de uso único com ESTA finalidade (MFA_ENFORCED).
export const MFA_PURPOSES = ["refund", "change_password", "delete_user", "connect_payment", "disconnect_payment", "device_token_create", "device_token_revoke", "cancel_subscription", "invite_owner"] as const;
export const mfaPurposeSchema = z.enum(MFA_PURPOSES);
export type MfaPurpose = z.infer<typeof mfaPurposeSchema>;

export const mfaChallengeSchema = z.object({ purpose: mfaPurposeSchema });
export type MfaChallengeInput = z.infer<typeof mfaChallengeSchema>;

export const mfaVerifySchema = z.object({
  challengeId: z.string().min(1).max(100),
  code: z.string().regex(/^\d{6}$/, "o código tem 6 dígitos"),
});
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

// ---- Fila de impressão (ADR-0004 §8) ----
// Corpo do ack que o print-client envia. `code` e `error` vêm do computador da loja: NÃO são confiáveis (a API normaliza
// o código para a lista fechada e sanitiza o texto); aqui só se limita o tamanho aceito.
export const printAckSchema = z.object({
  status: z.enum(["PRINTED", "FAILED"]),
  code: z.string().max(40).optional(),
  error: z.string().max(2000).optional(),
});
export type PrintAckInput = z.infer<typeof printAckSchema>;

// Modo de impressão da loja (ADR-0004 §8.12). Só o OWNER altera.
export const printModeSchema = z.enum(["LEGACY", "QUEUE"]);
export type PrintModeValue = z.infer<typeof printModeSchema>;
export const setPrintModeSchema = z.object({ mode: printModeSchema });

// ---- Taxa de entrega por bairro (API-16 / B9) ----
export const DELIVERY_ZONE_LIMIT = 300; // RN-B9-09
const zoneMinutes = z.number().int().min(1).max(1440);
export const deliveryZoneFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  feeCents: z.number().int().nonnegative().max(10_000_000),
  etaMinMinutes: zoneMinutes.nullable().optional(),
  etaMaxMinutes: zoneMinutes.nullable().optional(),
  freeFromCents: z.number().int().positive().max(100_000_000).nullable().optional(),
  active: z.boolean().optional(),
});
export const createDeliveryZoneSchema = deliveryZoneFieldsSchema.refine(
  (v) => v.etaMinMinutes == null || v.etaMaxMinutes == null || v.etaMinMinutes <= v.etaMaxMinutes,
  { message: "o prazo mínimo não pode passar do máximo", path: ["etaMinMinutes"] },
);
export type CreateDeliveryZoneInput = z.infer<typeof createDeliveryZoneSchema>;
export const updateDeliveryZoneSchema = deliveryZoneFieldsSchema.partial();
export type UpdateDeliveryZoneInput = z.infer<typeof updateDeliveryZoneSchema>;

export const importDeliveryZonesSchema = z.object({
  text: z.string().max(60_000), // uma linha por bairro: "nome; taxa"
  dryRun: z.boolean().optional(), // true = só pré-visualiza (nada é gravado)
});
export type ImportDeliveryZonesInput = z.infer<typeof importDeliveryZonesSchema>;

export const DELIVERY_OUTSIDE_MODES = ["REFUSE", "DEFAULT_FEE"] as const;
export const deliveryZonesConfigSchema = z.object({
  outsideMode: z.enum(DELIVERY_OUTSIDE_MODES).optional(),
  freeShippingFromCents: z.number().int().positive().max(100_000_000).nullable().optional(),
});
export type DeliveryZonesConfigInput = z.infer<typeof deliveryZonesConfigSchema>;
// ---- Onboarding e verificação de e-mail (API-26 / ONB) ----
// RN-ONB-02: endereços do cardápio que a plataforma usa para ela mesma (lista inicial; a final fecha com o Atlas).
export const RESERVED_SLUGS = [
  "admin", "api", "app", "loja", "lojas", "dashboard", "painel", "login", "logout", "cadastro", "registro", "register", "auth",
  "www", "mail", "suporte", "ajuda", "help", "status", "health", "static", "assets", "public", "pedido", "pedidos", "mesa",
  "cardapio", "meucardapio", "plataforma", "termos", "privacidade", "planos", "preco", "precos", "blog", "docs", "webhook", "webhooks",
] as const;
export const isReservedSlug = (slug: string): boolean => (RESERVED_SLUGS as readonly string[]).includes(slug.toLowerCase()) || slug.startsWith("_");

export const verifyEmailSchema = z.object({ token: z.string().min(1).max(200) });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const ONBOARDING_STEPS = ["STORE_DATA", "HOURS", "FIRST_PRODUCT", "DELIVERY", "PAYMENTS", "PRINTER", "TEST_ORDER", "SHARE"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
export const onboardingStepStatusSchema = z.object({ status: z.enum(["DONE", "SKIPPED", "PENDING"]) });
export type OnboardingStepStatusInput = z.infer<typeof onboardingStepStatusSchema>;
// ---- Back-office da plataforma (API-25) ----

const platformReason = z.string().trim().min(5, "informe o motivo (mínimo 5 caracteres)").max(300);

export const platformLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export const platformMfaVerifySchema = z.object({
  challengeId: z.string().min(1).max(100),
  code: z.string().regex(/^\d{6}$/, "o código tem 6 dígitos"),
});

export const PLATFORM_MFA_PURPOSES = ["platform_login", "platform_credit_grant"] as const;
export const platformMfaChallengeSchema = z.object({ purpose: z.enum(PLATFORM_MFA_PURPOSES).exclude(["platform_login"]) });

export const platformStoreListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const platformReasonSchema = z.object({ reason: platformReason });
export const platformExtendTrialSchema = z.object({ days: z.number().int().min(1).max(60), reason: platformReason });

export const platformCreateNoticeSchema = createNoticeSchema;

export const platformCreditGrantSchema = z
  .object({
    reason: z.enum(["PURCHASE", "GRANT", "ADJUST"]),
    credits: z.number().int().min(-1000).max(1000).refine((value) => value !== 0, "a quantidade não pode ser zero"),
    note: platformReason,
    externalRef: z.string().trim().min(3).max(120).regex(/^[\w .\-/#:]+$/, "referência com caracteres inválidos").optional(),
    priceCents: z.number().int().min(0).max(100_000_000).optional(),
    expiresAt: z.string().datetime().optional(),
    idempotencyKey: z.string().trim().min(8).max(100),
    password: z.string().min(1).max(200),
  })
  .superRefine((value, ctx) => {
    if (value.reason !== "ADJUST" && value.credits < 0) ctx.addIssue({ code: "custom", path: ["credits"], message: "só o ajuste (ADJUST) pode ser negativo" });
    if (value.reason === "PURCHASE" && !value.externalRef) ctx.addIssue({ code: "custom", path: ["externalRef"], message: "compra exige a referência do pagamento recebido" });
    if (value.credits < 0 && (value.priceCents !== undefined || value.externalRef !== undefined)) ctx.addIssue({ code: "custom", path: ["priceCents"], message: "ajuste negativo não leva preço nem referência de pagamento" });
  });
export type PlatformCreditGrantInput = z.infer<typeof platformCreditGrantSchema>;
