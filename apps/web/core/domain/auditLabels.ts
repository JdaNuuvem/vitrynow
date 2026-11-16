// Tradução das ações registradas pela API (lib/audit.ts). Ação nova sem rótulo aparece com o
// código cru, o que ainda serve pra investigar.
const AUDIT_ACTION_LABELS: Record<string, string> = {
  "device_token.create": "criou chave de impressora",
  "device_token.revoke": "revogou chave de impressora",
  "category.delete": "excluiu categoria",
  "product.delete": "excluiu produto",
  "coupon.delete": "excluiu cupom",
  "deliverer.delete": "excluiu entregador",
  "cashier.close": "fechou o caixa",
  "store.settings_update": "alterou configurações da loja",
  "user.delete": "removeu usuário da equipe",
  "order.refund": "estornou pagamento de pedido",
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}
