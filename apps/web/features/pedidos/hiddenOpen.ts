// WEB-37 / API-70 (Leonardo): o kanban mostra todos os abertos de HOJE e os 500 abertos mais novos de dias anteriores; o que passa disso
// fica de fora e a API avisa com `openCapped` e `openHidden`. A faixa diz quantos ficaram de fora e leva ao Histórico › Em aberto
// (WEB-44, a tela que a frase promete: a faixa nunca vai ao ar sem ela).

export const HISTORY_HREF = "/dashboard/pedidos/historico";
export const HISTORY_OPEN_HREF = `${HISTORY_HREF}?status=ABERTO`;

/** Quantos pedidos abertos a API deixou de fora. Só um inteiro >= 1 conta: ausente (API antiga), 0, negativo, texto ou NaN = nenhum. */
export function hiddenOpenCount(response: { openHidden?: unknown } | null | undefined): number {
  const value = response?.openHidden;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : 0;
}

const formatCount = (count: number) => count.toLocaleString("pt-BR");

const LINK_LABEL = "Histórico › Em aberto";

// A frase em três partes: o que vem antes do caminho, o caminho (que vira link) e o ponto final. Juntas dão EXATAMENTE a frase aprovada
// (plural pelo Ogilvy; singular validado por ele em 17/11).
export function hiddenOpenParts(count: number): { before: string; link: string; after: string } {
  const before = count === 1 ? "1 pedido antigo em aberto não aparece aqui. Veja em " : `${formatCount(count)} pedidos antigos em aberto não aparecem aqui. Veja em `;
  return { before, link: LINK_LABEL, after: "." };
}

export function hiddenOpenMessage(count: number): string {
  const { before, link, after } = hiddenOpenParts(count);
  return `${before}${link}${after}`;
}
