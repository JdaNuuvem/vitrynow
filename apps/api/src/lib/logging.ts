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

export function loggerOptions() {
  return {
    redact: { paths: REDACT_PATHS, censor: "[redigido]" },
    serializers: {
      // mesmo formato do serializador padrão do Fastify (método, URL, host, IP), com a query sem segredos
      req(request: { method?: string; url?: string; hostname?: string; ip?: string; socket?: { remotePort?: number } }) {
        return { method: request.method, url: redactLogUrl(request.url), hostname: request.hostname, remoteAddress: request.ip, remotePort: request.socket?.remotePort };
      },
    },
  };
}
