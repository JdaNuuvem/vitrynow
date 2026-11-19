// Teto de tentativas AUTOMÁTICAS de estorno (API-06a). Mora aqui (sem dependências) para a view, o histórico e o serviço usarem o MESMO número.
export const MAX_REFUND_AUTO_ATTEMPTS = 5;
export const refundAutoRetryable = (payment: { refundAttempts: number }) => payment.refundAttempts < MAX_REFUND_AUTO_ATTEMPTS;
