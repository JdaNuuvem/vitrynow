// SEC-13 (ST-14): em PRODUÇÃO a API não sobe com a confirmação de segurança (MFA) desligada. `MFA_ENFORCED` desligado é o padrão do código para dev e
// teste (sem provedor de e-mail); esquecer a variável em produção deixaria reembolso, chave de impressora, troca de dono etc. só com o cookie.
// Ambiente que não seja explicitamente `development`/`test` conta como produção (mesma regra da SEC-22: NODE_ENV ausente = produção).
export function assertMfaBootConfig(env: NodeJS.ProcessEnv = process.env): void {
  const relaxed = env.NODE_ENV === "development" || env.NODE_ENV === "test";
  if (relaxed) return;
  if (env.MFA_ENFORCED !== "true") {
    throw new Error('MFA_ENFORCED deve ser "true" em produção (a confirmação por código protege reembolso, chaves de impressora, cancelamento e convite de dono). Em dev/teste use NODE_ENV=development ou test.');
  }
}
