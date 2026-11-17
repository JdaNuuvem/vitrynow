// NG-16 / NG-11: redação de segredos nas linhas de log. O serializador padrão do Fastify não loga cabeçalhos, mas
// qualquer `log.info({ req })`/serializador futuro os traria: o token do pedido, a sessão, o MFA e o token do admin
// nunca podem aparecer em texto. `censor` fixo; testado em tests/order-token.test.ts.
export const REDACT_PATHS = [
  'req.headers["x-order-token"]',
  'req.headers["x-mfa-challenge"]',
  'req.headers["x-admin-token"]',
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  'headers["x-order-token"]',
  'headers["x-mfa-challenge"]',
  'headers["x-admin-token"]',
  "headers.authorization",
  "headers.cookie",
];

// A URL da requisição entra no log com a query inteira. O contrato manda o token do pedido SÓ por cabeçalho, mas um cliente
// (ou um atacante) que o mande na query o gravaria em texto no log: parâmetros com nome de segredo têm o VALOR trocado
// (o nome continua, para diagnóstico). Cobre `code`/`state` do OAuth e nomes comuns de credencial. É lista de NOMES:
// o que não está nela passa em texto, então novo parâmetro sensível entra aqui (ou, melhor, vai por cabeçalho/corpo).
const SENSITIVE_QUERY_KEY = /token|secret|password|passwd|pwd|passcode|senha|code|state|key|signature|sig|auth|bearer|credential|jwt|otp|session|sid|cookie/i;
// `&` e `;` separam parâmetros (RFC 3986 permite os dois; alguns servidores e proxies aceitam `;`).
const QUERY_SEPARATOR = /([&;])/;
// Parâmetro SOLTO (sem `=`) que parece uma credencial: ≥ 16 caracteres de token (letras, números, `_`, `-`, `.`) com letra e número.
const BARE_CREDENTIAL = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_.-]{16,}$/;

function redactPair(pair: string): string {
  const eq = pair.indexOf("=");
  if (eq === -1) return BARE_CREDENTIAL.test(pair) ? "[redigido]" : pair;
  const name = pair.slice(0, eq);
  let decoded = name;
  try {
    decoded = decodeURIComponent(name.replace(/\+/g, " "));
  } catch {
    // nome malformado: usa o texto cru para a checagem
  }
  return SENSITIVE_QUERY_KEY.test(decoded) ? `${name}=[redigido]` : pair;
}

export function redactLogUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const queryAt = url.indexOf("?");
  if (queryAt === -1) return url;
  const hashAt = url.indexOf("#", queryAt);
  const query = url.slice(queryAt + 1, hashAt === -1 ? undefined : hashAt);
  const redacted = query
    .split(QUERY_SEPARATOR)
    .map((piece, index) => (index % 2 === 1 ? piece : redactPair(piece)))
    .join("");
  return `${url.slice(0, queryAt)}?${redacted}${hashAt === -1 ? "" : url.slice(hashAt)}`;
}

// SEC-31 (ST-70): a redação acima cobre a QUERY, não o CAMINHO. O que vai no caminho (o `orderId` de /stores/:slug/orders/:orderId/payment-status,
// que é a credencial do cliente; o token de acompanhamento e o `qrToken` da mesa, pelo desenho da API-19/API-22) saía em texto em TODA
// requisição. Por isso o log leva o MODELO da rota (`/stores/:slug/orders/:orderId/payment-status`), nunca o valor do parâmetro dinâmico.
// Seguro por padrão: o que passa a ser logado é uma constante do código, então rota nova com segredo no caminho já nasce coberta.
// Sem rota casada (404), o caminho é de quem chamou e pode ter um segredo digitado: fica só o 1º segmento.
function unmatchedPath(path: string): string {
  const [, first = "", ...rest] = path.split("/");
  const head = BARE_CREDENTIAL.test(first) ? "[redigido]" : first;
  return rest.length > 0 ? `/${head}/[redigido]` : `/${head}`;
}

export function routeLogUrl(request: { url?: string; routeOptions?: { url?: string } }): string | undefined {
  const url = request.url;
  if (!url) return url;
  const queryAt = url.indexOf("?");
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  const query = queryAt === -1 ? "" : (redactLogUrl(url) ?? "").slice(queryAt);
  return `${request.routeOptions?.url ?? unmatchedPath(path)}${query}`;
}

export function loggerOptions() {
  return {
    redact: { paths: REDACT_PATHS, censor: "[redigido]" },
    serializers: {
      // mesmo formato do serializador padrão do Fastify (método, URL, host, IP), com o MODELO da rota e a query sem segredos
      req(request: { method?: string; url?: string; routeOptions?: { url?: string }; hostname?: string; ip?: string; socket?: { remotePort?: number } }) {
        return { method: request.method, url: routeLogUrl(request), hostname: request.hostname, remoteAddress: request.ip, remotePort: request.socket?.remotePort };
      },
    },
  };
}
