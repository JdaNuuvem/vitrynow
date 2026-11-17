// WEB-37 / API-70 (Leonardo): o kanban mostra todos os abertos de HOJE e os 500 abertos mais novos de dias anteriores; o que passa disso
// fica de fora e a API avisa com `openCapped` e `openHidden`. A faixa diz quantos ficaram de fora e leva ao Histórico › Em aberto.

/** Quantos pedidos abertos a API deixou de fora. Só um inteiro >= 1 conta: ausente (API antiga), 0, negativo, texto ou NaN = nenhum. */
export function hiddenOpenCount(response: { openHidden?: unknown } | null | undefined): number {
  const value = response?.openHidden;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 0;
}

const formatCount = (count: number) => count.toLocaleString("pt-BR");

// Texto aprovado pelo Ogilvy no plural (17/11). O SINGULAR é meu, para "1 pedidos antigos" não aparecer na tela: o Ogilvy valida.
export function hiddenOpenMessage(count: number): string {
  return count === 1
    ? "1 pedido antigo em aberto não aparece aqui. Veja em Histórico › Em aberto."
    : `${formatCount(count)} pedidos antigos em aberto não aparecem aqui. Veja em Histórico › Em aberto.`;
}
