import { z } from "zod";

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
  notes: z.string().max(300).optional(),
  additionalIds: z.array(z.string().min(1)).max(50).optional(),
});

// "CARTAO" é o valor legado do checkout antigo e vale como CREDITO.
export const paymentMethodSchema = z.enum(["PIX", "DINHEIRO", "CARTAO", "CREDITO", "DEBITO", "VR", "VA"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const createOrderSchema = z.object({
  type: orderTypeSchema,
  customerName: z.string().min(1).max(150).optional(),
  customerPhone: phoneSchema.optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
  items: z.array(createOrderItemSchema).min(1).max(100),
  couponCode: z.string().min(1).max(50).optional(),
  paymentMethod: paymentMethodSchema.optional(),
  changeForCents: z.number().int().positive().max(100_000_000).optional(),
  tipCents: z.number().int().nonnegative().max(10_000_000).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

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
  storeName: z.string().min(1).max(150),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, "use apenas letras minúsculas, números e hífen"),
  code: z.string().min(1).max(30),
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
  z.object({ type: z.literal("payment.reconcile_needed"), orderId: z.string() }),
  // Fila de impressão (ADR-0004): só "acorde e peça job"; nenhum dado de pedido ou cliente no canal.
  z.object({ type: z.literal("print.available") }),
  z.object({ type: z.literal("print.job_failed"), jobId: z.string() }),
  // Caixa (CA-CX-28): o STAFF fechou com diferença ACIMA da tolerância. Só o id do caixa, o papel e o valor em centavos; nunca o texto do motivo.
  z.object({ type: z.literal("cashier.difference_over_tolerance"), sessionId: z.string() }),
  // PC-24: alerta de dispositivo para o painel do dono. Só o CÓDIGO (a frase sai do código no painel); nada de pedido, cliente ou texto livre.
  z.object({ type: z.literal("device.alert"), code: z.string() }),
  z.object({ type: z.literal("ping") }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

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
export const TICKET_SCHEMA_VERSION = 3; // 1 = contrato anterior (sem os campos do B4); 2 = B4; 3 = `nothingToCharge` (API-66). O print-client antigo ignora o que não conhece

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
  tableLabel: z.string().nullable().optional(), // "Mesa 12" (API-22; null até existir mesa)
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
  name: z.string().min(1).max(150),
  icon: z.string().max(8).optional().or(z.literal("")),
  position: z.number().int().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const productAdditionalInputSchema = z.object({
  id: z.string().optional(), // presente ao editar um adicional existente
  name: z.string().min(1).max(150),
  priceCents: z.number().int().nonnegative().max(100_000_000),
});

export const createProductSchema = z.object({
  categoryId: z.string().min(1).optional(),
  name: z.string().min(1).max(150),
  description: z.string().max(1000).optional(),
  imageUrl: z.string().url().max(500).optional().or(z.literal("")),
  priceCents: z.number().int().nonnegative().max(100_000_000),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  position: z.number().int().optional(),
  additionals: z.array(productAdditionalInputSchema).max(50).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

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
export const orderInternalNoteSchema = z.object({ note: z.string().max(500).nullable() });

// ---- Caixa (painel) ----

export const openCashSessionSchema = z.object({
  openingBalanceCents: z.number().int().nonnegative().max(100_000_000), // teto da RN-CX-12 (R$ 1.000.000,00)
  notes: z.string().trim().max(300).optional(),
});
export type OpenCashSessionInput = z.infer<typeof openCashSessionSchema>;

// `closingBalanceCents` ausente/nulo NUNCA vira 0 por omissão: o servidor responde 400 CASH_COUNTED_REQUIRED (zero digitado de propósito vale).
// `reason`/`reasonText` são validados pelo servidor contra a lista fechada (CASH_REASON_REQUIRED / CASH_REASON_INVALID).
export const closeCashSessionSchema = z.object({
  closingBalanceCents: z.number().int().nonnegative().max(100_000_000).nullable().optional(),
  notes: z.string().trim().max(300).optional(),
  reason: z.string().max(40).nullable().optional(),
  reasonText: z.string().max(400).nullable().optional(),
});
export type CloseCashSessionInput = z.infer<typeof closeCashSessionSchema>;

export const cashMovementTypeSchema = z.enum(["SUPRIMENTO", "SANGRIA"]);

// Motivo OBRIGATÓRIO em toda movimentação (RN-CX-07): o servidor valida `reason` contra a lista do TIPO; `notes` NÃO substitui `reason`.
export const createCashMovementSchema = z.object({
  type: cashMovementTypeSchema,
  amountCents: z.number().int().positive().max(100_000_000),
  notes: z.string().max(300).optional(),
  reason: z.string().max(40).nullable().optional(),
  reasonText: z.string().max(400).nullable().optional(),
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
  name: z.string().min(1).max(150).optional(),
  logoUrl: z.string().url().max(500).optional().or(z.literal("")),
  coverImageUrl: z.string().url().max(500).optional().or(z.literal("")),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "use um hex de cor, ex. #16a34a")
    .optional()
    .or(z.literal("")),
  customDomain: z.string().max(200).optional().or(z.literal("")),
  address: z.string().max(300).optional().or(z.literal("")),
  whatsapp: z
    .string()
    .regex(/^[0-9]{10,15}$/, "use só números com DDI, ex. 5521999999999")
    .optional()
    .or(z.literal("")),
  openingHours: z.string().max(200).optional().or(z.literal("")),
  minOrderCents: z.number().int().nonnegative().max(100_000_000).optional(),
  deliveryEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  deliveryFeeCents: z.number().int().nonnegative().max(10_000_000).optional(),
});
export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;

// ---- Entregadores ----

export const createDelivererSchema = z.object({
  name: z.string().min(1).max(150),
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
  message: z.string().trim().min(1).max(2000),
});
export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

// ---- Loja disponível/fechada ----

export const storeAvailabilitySchema = z.object({ acceptingOrders: z.boolean() });
export type StoreAvailabilityInput = z.infer<typeof storeAvailabilitySchema>;

// ---- Planos e assinatura ----

export const checkoutPlanSchema = z.object({ planCode: z.string().min(1).max(50) });
export type CheckoutPlanInput = z.infer<typeof checkoutPlanSchema>;

// ---- Avisos da plataforma ----

export const createNoticeSchema = z.object({
  title: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(2000),
  imageUrl: z.string().url().max(500).optional(),
  expiresAt: z.string().datetime().optional(),
});
export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;

// ---- Confirmação de segurança (MFA por e-mail) ----

export const MFA_PURPOSES = ["refund", "change_password", "delete_user"] as const;
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
