// Lista CENTRAL de como cada rota se comporta na Consulta e na Suspensão (ADR-0003 §2.3,
// CA-B17-08, RN-A-01..03). Um só lugar: nada de `if` espalhado pelas rotas. O plugin
// `plugins/subscriptionGate.ts` aplica esta tabela; `tests/route-policy.test.ts` falha se uma rota
// de escrita nova não estiver classificada aqui (nem rota listada que deixou de existir).
//
// Chave: "MÉTODO /caminho/registrado/no/fastify" (com os :parâmetros).

/**
 * Painel (rota com `requirePanelAuth`).
 * - `blocked`  — escrita de cadastro/config/pedido novo: Consulta ⇒ 403 READ_ONLY; Suspensão ⇒ 402 SUSPENDED.
 * - `finish`   — encerra o que JÁ foi recebido (RN-A-01): liberada na Consulta enquanto `access.canFinishInProgress`
 *                (decisão do Claudio, reversível); Suspensão ⇒ 402.
 * - `allowed`  — liberada na Consulta (leitura, ações pessoais); Suspensão ⇒ 402.
 * - `billing`  — liberada na Consulta E na Suspensão (pagar, ver a conta, sair).
 * - `export`   — exportação de dados do próprio lojista (CSV; decisão do Atlas, ADR-0003 §5): liberada na Consulta e
 *                também na Suspensão, mas na Suspensão SÓ para OWNER. O limite de uso (rate limit), a auditoria e
 *                "não guardar o arquivo" são da rota; nenhuma outra rota do painel abre por causa disso.
 * Leitura (GET) sem entrada aqui vale `allowed`; escrita sem entrada vale `blocked` e reprova o teste de contrato.
 */
export type PanelPolicy = "blocked" | "finish" | "allowed" | "billing" | "export";

export const PANEL_ROUTE_POLICY: Record<string, PanelPolicy> = {
  // — Pedidos já recebidos (RN-A-01: aceitar, recusar, avançar, concluir, cancelar, estornar) —
  "POST /api/orders/:id/transition": "finish", // API-02: avançar
  "POST /api/orders/:id/cancel": "finish", // API-02: cancelar/recusar com motivo (e estorno em saga)
  "POST /api/orders/:id/refund/retry": "finish", // API-02: tentar o estorno de novo
  "POST /api/orders/:id/undo": "finish", // API-02: desfazer dentro da janela
  "POST /api/orders/:id/status": "finish", // legado (alias deprecated até WEB-05)
  "POST /api/orders/:id/refund": "finish",
  "POST /api/orders/:id/payment/check": "finish", // conferir o pagamento de pedido JA recebido (PIX aguardando); nao cria pedido novo
  "POST /api/orders/:id/deliverer": "finish",
  "POST /api/orders/:id/reprint": "finish", // API-12b: 2ª via de pedido JÁ recebido (STAFF só até 24 h; a regra é da rota)
  "POST /api/orders/:id/internal-note": "blocked", // API-54: anotação da equipe é cadastro, não encerra pedido
  "POST /api/orders": "blocked", // API-13: pedido MANUAL é pedido novo (RN-B2-13): Consulta 403 READ_ONLY, Suspensão 402

  // — Caixa: fechar pode (RN-A-01); abrir e movimentar não —
  "POST /api/cashier/close": "finish",
  "POST /api/cashier/open": "blocked",
  "POST /api/cashier/movements": "blocked",
  "PUT /api/cashier/staff-withdrawal-limit": "blocked", // API-27: configuração do caixa
  "POST /api/cashier/notices/:id/dismiss": "allowed", // API-27: dispensar um aviso é ação pessoal, não cria nem altera dado de negócio

  // — Cadastro e configuração: nada disso na Consulta —
  "POST /api/catalog/categories": "blocked",
  "POST /api/catalog/categories/:id": "blocked",
  "POST /api/catalog/categories/:id/delete": "blocked",
  "POST /api/catalog/products": "blocked",
  "POST /api/catalog/products/:id": "blocked",
  "POST /api/catalog/products/:id/delete": "blocked",
  "POST /api/coupons": "blocked",
  "POST /api/coupons/:id": "blocked",
  "POST /api/coupons/:id/delete": "blocked",
  "POST /api/deliverers": "blocked",
  "POST /api/deliverers/:id": "blocked",
  "POST /api/deliverers/:id/delete": "blocked",
  "POST /api/store/settings": "blocked",
  "POST /api/store/availability": "blocked",
  "POST /api/store/hours": "blocked",
  "POST /api/store/status": "blocked", // pausar/fechar por hoje: na Consulta já não há pedido novo para pausar
  "POST /api/users": "blocked",
  "POST /api/users/:id/delete": "blocked",
  "POST /api/store/payments/mercadopago/connect": "blocked", // API-07: conectar a conta de PIX é configuração (sem loja ativa não conecta)
  "POST /api/store/payments/mercadopago/disconnect": "blocked", // API-07: idem
  "PUT /api/store/print-mode": "blocked", // API-12b: modo de impressão é configuração
  "POST /api/print-jobs/test": "blocked", // API-12: teste de impressora é configuração
  "POST /api/device-tokens": "blocked",
  // Matriz do Leonardo (leonardo/matriz-rotas-por-fase.md): revogar chave é "cadastro" ⇒ bloqueado na
  // Consulta. Risco anotado no quadro: chave vazada só pode ser revogada depois de reativar.
  "POST /api/device-tokens/:id/revoke": "blocked",

  // — Leitura e "Quero ser avisado": liberados na Consulta, fechados na Suspensão —
  "POST /api/store/feature-interest": "allowed",
  "POST /api/notices/:id/read": "allowed",

  // — Conta, segurança e pagamento: liberados também na Suspensão (RN-A-03, matriz §2 "Conta e assinatura") —
  "POST /auth/change-password": "billing",
  "POST /auth/logout-all": "billing", // "sair de todos os dispositivos" (B03): segurança, sempre permitido
  "POST /api/mfa/challenge": "billing",
  "POST /api/mfa/verify": "billing",
  "POST /api/feedback": "billing", // canal de contato do lojista, também no pior momento
  "POST /api/store/subscription/checkout": "billing",
  "POST /api/store/subscription/cancel": "billing",
  "GET /auth/me": "billing",
  "GET /api/plans": "billing",
  "GET /api/store/plan": "billing",
  "GET /api/store/subscription": "billing",
  "GET /api/store/subscription/payments/:id": "billing",

  // — Lote 1 (Atlas): rotas que apareceram quando as branches se encontraram; classe conservadora, revisar com o dono de cada uma —
  "POST /api/orders/:id/refund/abandon": "finish", // API-61: encerrar pedido sem estorno (OWNER; encerra o que ja foi recebido)
  "PUT /api/store/manual-discount-limit": "blocked", // SEC-15: configuracao
  "POST /api/print-jobs/:id/print-now": "allowed", // N6: reimprimir tiquete antigo (STALE) reduz prejuizo; vale na Consulta
  "POST /api/catalog/products/:id/sold-out": "blocked", // API-17: cadastro
  "POST /api/delivery-zones": "blocked", // API-16: configuracao
  "POST /api/delivery-zones/:id": "blocked",
  "POST /api/delivery-zones/:id/delete": "blocked",
  "POST /api/delivery-zones/import": "blocked",
  "POST /api/delivery-zones/config": "blocked",
  "POST /api/auth/verify-email/resend": "billing", // API-26: conta, tambem liberado na Suspensao
  "POST /api/onboarding/steps/:step": "blocked", // API-26: cadastro guiado
};

/**
 * Rotas SEM `requirePanelAuth` nem `requireDeviceAuth` que escrevem (ou precisam de tratamento).
 * - `exempt`        — nunca bloqueada pela assinatura (autenticação, webhook de pagamento, admin da plataforma).
 * - `public-order`  — cria pedido pelo cardápio/QR: sem `publicOrders` ⇒ 409 SUBSCRIPTION_INACTIVE (RN-A-02).
 * - `public-menu`   — cardápio: Consulta ⇒ `acceptingOrders:false`; Suspensão ⇒ 503 STORE_UNAVAILABLE sem dados da loja.
 * - `public-allowed`— segue funcionando (cliente acompanha ou cancela pedido que já fez).
 */
export type PublicPolicy = "exempt" | "public-order" | "public-menu" | "public-allowed";

export const PUBLIC_ROUTE_POLICY: Record<string, PublicPolicy> = {
  "POST /auth/register": "exempt",
  "POST /auth/login": "exempt",
  "POST /auth/logout": "exempt", // sair é sempre permitido, inclusive suspenso (RN-A-03)
  "POST /auth/forgot-password": "exempt",
  "POST /auth/reset-password": "exempt",
  "POST /auth/reset-password/inspect": "exempt", // SEC-29: confere o link antes de pedir a senha nova
  // Webhook do Mercado Pago: segue processando em qualquer fase (é o que reativa e concilia o PIX).
  "POST /api/payments/webhook": "exempt",
  // Admin da plataforma por x-admin-token (some com o back-office, API-25).
  "POST /auth/verify-email": "exempt", // API-26: confirma o e-mail pelo link (publico, token no corpo)
  "POST /api/admin/notices": "exempt",
  "POST /api/admin/notices/:id/delete": "exempt",
  "POST /stores/:slug/orders": "public-order",
  "GET /stores/:slug/menu": "public-menu",
  "GET /stores/:slug/orders/:orderId/payment-status": "public-allowed",
  "POST /stores/:slug/orders/:orderId/cancel": "public-allowed",
  // API-19: o cliente acompanha o pedido que já fez, também com a loja em Consulta/Suspensão (decisão do Atlas).
  "GET /stores/:slug/orders/:orderId/tracking": "public-allowed",
};

export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function policyKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}
