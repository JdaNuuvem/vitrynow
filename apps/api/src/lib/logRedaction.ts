// Log sem segredo na URL (P-3, parecer da Nightingale): o callback do OAuth traz `code` e `state` na query; o log padrão do
// Fastify gravaria a URL inteira. Nessas rotas a query some do log (o caminho continua, para diagnóstico).
const SENSITIVE_QUERY_PATHS = ["/api/store/payments/mercadopago/callback", "/auth/reset-password"];

export function redactLogUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const queryAt = url.indexOf("?");
  if (queryAt === -1) return url;
  const path = url.slice(0, queryAt);
  return SENSITIVE_QUERY_PATHS.includes(path) ? `${path}?[redigido]` : url;
}
