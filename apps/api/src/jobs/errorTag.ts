// Log de falha dos jobs de pagamento: SÓ o nome e o código do erro (nunca mensagem nem pilha, que podem trazer e-mail, token ou valor).
export function errorTag(error: unknown): { type: string; code?: string } {
  if (!(error instanceof Error)) return { type: "NaoErro" };
  const code = (error as { code?: unknown }).code;
  return { type: error.name, ...(typeof code === "string" && /^[A-Za-z0-9_.-]{1,30}$/.test(code) ? { code } : {}) };
}
