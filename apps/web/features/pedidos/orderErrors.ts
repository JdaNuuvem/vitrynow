// Tradução dos erros das rotas de pedido para o que o dono lê. O código nunca aparece na tela; o texto da
// API (já em português) só é usado quando o código não tem tratamento próprio. Contrato B3 §2 e §5.

export type OrderFailure = { status: number; error: string; code?: string };

export type OrderError = {
  message: string;
  // O pedido mudou por outro lado (outro usuário, cliente, tempo): recarregar a lista resolve.
  reload: boolean;
};

const STATE_CHANGED = "Este pedido já mudou. A tela foi atualizada.";

const BY_CODE: Record<string, OrderError> = {
  ORDER_STATE_CHANGED: { message: STATE_CHANGED, reload: true },
  INVALID_TRANSITION: { message: STATE_CHANGED, reload: true },
  ORDER_NOT_FOUND: { message: "Este pedido não foi encontrado. A tela foi atualizada.", reload: true },
  ORDER_ALREADY_ACCEPTED: { message: "A loja já aceitou este pedido. A tela foi atualizada.", reload: true },
  REFUND_PENDING: { message: "O estorno deste pedido está em andamento.", reload: true },
  NOT_REFUND_PENDING: { message: "Este pedido não tem estorno pendente. A tela foi atualizada.", reload: true },
  UNDO_WINDOW_EXPIRED: { message: "O prazo para voltar este pedido acabou. Só o dono pode voltar agora.", reload: true },
  NOTHING_TO_UNDO: { message: "Não há o que desfazer neste pedido.", reload: true },
  FORBIDDEN_ROLE: { message: "Seu perfil não permite esta ação.", reload: false },
  REASON_REQUIRED: { message: "Escolha um motivo para continuar.", reload: false },
  REASON_INVALID: { message: "Este motivo não pode ser usado. Escolha outro.", reload: false },
  READ_ONLY: { message: "Esta ação precisa da assinatura ativa.", reload: false },
};

const NETWORK = "Não foi possível conectar ao servidor. Verifique sua internet e tente de novo.";

export function explainOrderError(failure: OrderFailure): OrderError {
  if (failure.code && BY_CODE[failure.code]) return BY_CODE[failure.code];
  // Falha de rede vem como 503 sintético (lib/api.ts): o texto já é o certo.
  if (failure.status === 503) return { message: failure.error || NETWORK, reload: false };
  // Código desconhecido: o texto da API, que já é pt-BR; nunca o código. Sem texto, uma frase segura.
  const text = failure.error?.trim();
  return { message: text && !/^[A-Z_]{4,}$/.test(text) ? text : "Não foi possível concluir esta ação. Tente de novo.", reload: false };
}
