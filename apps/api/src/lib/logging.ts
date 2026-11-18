// NG-16 / NG-11: redação de segredos nas linhas de log. O serializador padrão do Fastify não loga cabeçalhos, mas
// qualquer `log.info({ req })`/serializador futuro os traria: o token do pedido, a sessão, o MFA e o token do admin
// nunca podem aparecer em texto. `censor` fixo; testado em tests/order-token.test.ts.
export const REDACT_PATHS = [
  'req.headers["x-order-token"]',
  'req.headers["x-mfa-challenge"]',
  'req.headers["x-admin-token"]',
  'req.headers["x-internal-service-secret"]',
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  'headers["x-order-token"]',
  'headers["x-mfa-challenge"]',
  'headers["x-admin-token"]',
  'headers["x-internal-service-secret"]',
  "headers.authorization",
  "headers.cookie",
  // SEC-31 (ST-72): curingas e campos do OAuth/provedor. O pino só casa `*` em UM nível, então cada profundidade usada por erro de
  // biblioteca HTTP (`err.config.headers`, `err.response.config.headers`) e por objeto de resposta do provedor está listada. O caso
  // do erro inteiro é coberto também pelo serializador `err` (abaixo), que nem leva `config`/`response`; aqui é a segunda camada.
  "*.authorization",
  "*.Authorization",
  "*.cookie",
  "*.Cookie",
  "*.headers.*",
  "*.*.headers.*",
  "*.*.*.headers.*",
  "*.*.*.*.headers.*",
  "err.config.headers.*",
  "*.access_token",
  "*.refresh_token",
  "*.client_secret",
  "*.accessToken",
  "*.refreshToken",
  "*.clientSecret",
  "*.password",
  "*.passwordHash",
  "access_token",
  "refresh_token",
  "client_secret",
  "password",
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
// ST-74: o 1º segmento (e o `hostname`, cabeçalho Host) é digitado por quem chama e não tem teto próprio: um 404 de 8 KB por requisição
// enche o disco do log. Por isso o texto logado de entrada do cliente é cortado (32 no segmento, 255 no Host).
export const LOG_CLIENT_TEXT_MAX = 32;
// o Host legítimo pode ser longo (subdomínios): o teto é o do DNS (255), suficiente contra um cabeçalho de 8 KB
export const LOG_HOSTNAME_MAX = 255;
export function clip(text: string | undefined, max: number = LOG_CLIENT_TEXT_MAX): string | undefined {
  if (text === undefined || text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function unmatchedPath(path: string): string {
  const [, first = "", ...rest] = path.split("/");
  const head = BARE_CREDENTIAL.test(first) ? "[redigido]" : clip(first)!;
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

// SEC-31 (ST-71/ST-72): o serializador de erro padrão do pino copia TODAS as propriedades do erro (`config.headers.Authorization` de um erro
// de biblioteca HTTP, `response.data` do provedor) e a mensagem do Prisma traz o trecho da chamada com os VALORES dos argumentos (nome,
// e-mail, telefone). Aqui o erro é reduzido a uma lista fixa de campos; erro do Prisma perde `message` e `stack` e fica com o que o
// diagnóstico precisa: código, tabela/campo (`meta.target`) e a operação (`prisma.store.create`).
const PRISMA_OPERATION = /Invalid `(prisma\.[\w$.]+)\(\)` invocation/;
const SAFE_META_KEYS = ["target", "modelName", "column", "table", "constraint", "field_name"] as const;

export function isPrismaError(error: unknown): boolean {
  return error instanceof Error && (/^PrismaClient/.test(error.name) || "clientVersion" in error);
}

function safeMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const source = meta as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SAFE_META_KEYS) {
    const value = source[key];
    if (typeof value === "string") out[key] = clip(value, 120);
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) out[key] = value.map((item) => clip(item as string, 120));
  }
  // erro de SQL cru (P2010): o SQLSTATE (22P02, 23505…) ajuda e não é valor; `meta.message` traz o valor, então fica de fora
  if (typeof source.code === "string" && /^[0-9A-Z]{5}$/.test(source.code)) out.sqlState = source.code;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function safeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: "NaoErro" }; // valor lançado que não é Error: nada dele vai para o log
  const code = (error as { code?: unknown }).code;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (isPrismaError(error)) {
    const errorCode = (error as { errorCode?: unknown }).errorCode;
    return {
      type: error.name,
      code: typeof code === "string" ? code : undefined,
      errorCode: typeof errorCode === "string" ? errorCode : undefined,
      meta: safeMeta((error as { meta?: unknown }).meta),
      operation: PRISMA_OPERATION.exec(error.message)?.[1],
    };
  }
  return {
    type: error.name,
    message: error.message,
    stack: error.stack,
    code: typeof code === "string" || typeof code === "number" ? code : undefined,
    statusCode: typeof statusCode === "number" ? statusCode : undefined,
  };
}

// SEC-31c (ST-72, defesa em profundidade): o `redact` do pino casa caminhos fixos e o serializador `err` só age na chave `err`. Um erro de
// biblioteca HTTP DENTRO de um objeto de contexto (`{ ctx: { cause: err } }`) ou um campo OAuth a 3+ níveis escapavam. Este formatador percorre o
// objeto logado RECURSIVAMENTE (até LOG_MAX_DEPTH níveis) e: (a) troca todo Error por `safeError`; (b) redige o valor de toda chave com nome de
// segredo, em qualquer profundidade e sem diferenciar caixa; (c) apaga o segredo de dentro de TEXTO (cabeçalho `Authorization: Bearer …`,
// `"access_token":"…"` em corpo serializado); (d) corta string longa e limita o número de chaves. É seguro por padrão: o que não passa fica de fora.
export const LOG_MAX_DEPTH = 8;
export const LOG_MAX_STRING = 2000;
const LOG_MAX_KEYS = 100;
const LOG_MAX_ITEMS = 50;
// SEC-33d: teto TOTAL de objetos/arrays visitados por chamada de log (100 chaves × 8 níveis seriam milhões de nós: medido pelo Deming, 20 chaves × 5 níveis = 5,7 s e 9 MB
// no laço de eventos). Passou do teto, o resto vira um marcador.
export const LOG_MAX_NODES = 2000;
// ... e de ENTRADAS (chaves de objeto + itens de lista) por chamada: 2.000 objetos de 100 chaves ainda seriam uma linha de log de megabytes.
export const LOG_MAX_ENTRIES = 5000;
type Walk = { seen: WeakSet<object>; nodes: number; entries: number };
const SECRET_KEY = /token|secret|passw|passwd|pwd|senha|authoriz|cookie|api[-_]?key|bearer|credential|signature|jwt|session/i;
// SEC-33 (ST-78): nomes curtos só por IGUALDADE (por trecho pegariam `author`, `spin`, `hotp`). `code` NÃO entra como chave: é o código do pedido e
// o código de erro em quase todo log; o `code`/`state` do OAuth vai na query e é apagado do TEXTO (QUERY_OAUTH abaixo) e da URL (`redactLogUrl`).
const SECRET_KEY_EXACT = /^(auth|pass|pin|otp|cvv)$/i;
const isSecretKey = (key: string) => SECRET_KEY.test(key) || SECRET_KEY_EXACT.test(key);
// segredo dentro de texto, em passes separados (a ordem importa):
//  1) linha de cabeçalho inteira: `Authorization: Digest …`, `Cookie: a=b; c=d`, `Set-Cookie: …` (vai até o fim da linha)
const HEADER_LINE = /\b(proxy-authorization|authorization|set-cookie|cookie)(\s*:\s*)[^\r\n]+/gi;
//  Sem `\b` antes do NOME de propósito (SEC-33e): `currentPassword`, `newPassword`, `userToken`, `apiSecret` (camelCase) também têm o valor redigido em texto.
//  1b) senha SEM aspas e com espaço (`password=ab cd ef`): vai até o fim da linha ou do parâmetro (`&`, `,`, `;`, `}`); redige a mais de propósito (SEC-33d)
const PASSWORD_UNQUOTED = /((?:password|passwd|pwd|senha)\s*[:=]\s*)([^\s"'\r\n&,};][^\r\n&,};"']*)/gi;
//  2) `nome=valor` / `"nome":"valor"` com valor entre aspas (aceita espaço e aspas ESCAPADAS dentro) ou sem aspas; inclui `token=`, `secret=` e `"cookie":"…"` soltos em texto
const NAMED_VALUE = /((?:access_token|refresh_token|client_secret|id_token|api[-_]?key|password|passwd|pwd|senha|token|secret|cookie|set-cookie|authorization|x-order-token|x-mfa-challenge|x-admin-token)\\?["']?\s*[:=]\s*)(\\"(?:(?!\\").)*\\"|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?:(?:bearer|basic|digest)\s+)?[^\s"'&,}]+)/gi;
//  2a) JSON serializado DUAS vezes (`{\"access_token\":\"X\"}`, o que um erro de biblioteca produz ao pôr o corpo em texto): a barra antes da aspa do nome e a do valor
//      (`\"…\"`) entram no padrão acima (SEC-33d, resto (a) do Sun Tzu). Escape de 3 ou mais níveis fica como resíduo aceito.
//  2b) credencial na URL (`postgres://usuario:SENHA@host`): é o que um erro de conexão do banco coloca em texto (SEC-33d)
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\/\s:@]*:)[^@\s\/]+(@)/gi;
//  3) esquema solto (`Bearer abc`), JWT puro (três partes em base64url, a 1ª começa com `eyJ`), `?code=`/`&state=` do OAuth
const SCHEME = /\b(bearer|basic)\s+[A-Za-z0-9._~+\/=-]{6,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const QUERY_OAUTH = /([?&](?:code|state)=)[^&\s]+/gi;
// chaves tratadas por serializador do pino (cada uma sabe o que loga): req/res/err e o `errorKey`; o formatador as deixa passar
const SERIALIZED_KEYS = new Set(["req", "res", "err"]);

export function scrubText(text: string): string {
  const cut = text.length > LOG_MAX_STRING ? `${text.slice(0, LOG_MAX_STRING)}…[cortado]` : text;
  return cut
    .replace(HEADER_LINE, (_match, name: string, colon: string) => `${name}${colon}[redigido]`)
    .replace(URL_CREDENTIALS, (_match, head: string, at: string) => `${head}[redigido]${at}`)
    .replace(PASSWORD_UNQUOTED, (_match, prefix: string) => `${prefix}[redigido]`)
    .replace(NAMED_VALUE, (_match, prefix: string, value: string) => {
      const quote = value.startsWith('\\"') ? '\\"' : value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
      return `${prefix}${quote}[redigido]${quote}`;
    })
    .replace(SCHEME, (_match, scheme: string) => `${scheme} [redigido]`)
    .replace(JWT, "[redigido]")
    .replace(QUERY_OAUTH, (_match, prefix: string) => `${prefix}[redigido]`);
}

// `code` e `state` (OAuth) só são segredo quando o VALOR parece credencial (≥ 16 caracteres, letras e números): o `code` do pedido e o de erro
// (`P2002`, `ERR_BAD_REQUEST`, `0042`) seguem legíveis em todo log.
const OAUTH_KEY = /^(code|state)$/i;
function isSecretEntry(key: string, value: unknown): boolean {
  if (isSecretKey(key)) return true;
  return OAUTH_KEY.test(key) && typeof value === "string" && BARE_CREDENTIAL.test(value);
}

// SEC-33 (ST-78): um LOG não pode derrubar a rota nem o tratador de 5xx. Objeto com getter que lança, Proxy hostil ou erro com `message` que
// lança viram um marcador, nunca uma exceção para quem chamou `log.info(...)`.
const UNREADABLE = "[ilegível]";

function sanitize(value: unknown, depth: number, walk: Walk): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  try {
    if (value instanceof Error) return safeError(value);
    if (value instanceof Date) return value;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return "[binário]";
    if (depth >= LOG_MAX_DEPTH) return "[profundo demais]";
    const object = value as Record<string, unknown>;
    if (walk.seen.has(object)) return "[circular]";
    if ((walk.nodes += 1) > LOG_MAX_NODES) return "[omitido: objeto grande demais]";
    walk.seen.add(object);
    try {
      if (Array.isArray(value)) {
        const allowed = Math.max(0, Math.min(LOG_MAX_ITEMS, LOG_MAX_ENTRIES - walk.entries));
        walk.entries += allowed;
        return value.slice(0, allowed).map((item) => sanitize(item, depth + 1, walk));
      }
      const out: Record<string, unknown> = {};
      let count = 0;
      for (const key of Object.keys(object)) {
        if (count >= LOG_MAX_KEYS || (walk.entries += 1) > LOG_MAX_ENTRIES) {
          out["[…]"] = "chaves omitidas";
          break;
        }
        count += 1;
        let child: unknown;
        try {
          child = object[key];
        } catch {
          out[key] = UNREADABLE; // getter que lança: o nome fica, o valor não
          continue;
        }
        out[key] = isSecretEntry(key, child) ? "[redigido]" : sanitize(child, depth + 1, walk);
      }
      return out;
    } finally {
      walk.seen.delete(object); // só ciclo de verdade é "circular": o mesmo objeto em dois ramos irmãos é logado nos dois
    }
  } catch {
    return UNREADABLE;
  }
}

export function sanitizeLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  try {
    const walk: Walk = { seen: new WeakSet<object>(), nodes: 0, entries: 0 };
    for (const key of Object.keys(obj)) {
      let value: unknown;
      try {
        value = obj[key];
      } catch {
        out[key] = UNREADABLE;
        continue;
      }
      if (SERIALIZED_KEYS.has(key)) out[key] = value; // o serializador da chave (req/res/err) cuida; não percorrer o objeto da requisição
      else out[key] = isSecretEntry(key, value) ? "[redigido]" : sanitize(value, 0, walk);
    }
  } catch {
    out.logSanitizeFailed = true; // falha inesperada ao percorrer: o que já foi limpo sai, e o log segue
  }
  return out;
}

export function loggerOptions() {
  return {
    redact: { paths: REDACT_PATHS, censor: "[redigido]" },
    // roda ANTES dos serializadores (pino): por isso deixa `req`/`res`/`err` intocados e limpa o resto
    formatters: { log: sanitizeLogObject },
    serializers: {
      // mesmo formato do serializador padrão do Fastify (método, URL, host, IP), com o MODELO da rota e a query sem segredos
      req(request: { method?: string; url?: string; routeOptions?: { url?: string }; hostname?: string; ip?: string; socket?: { remotePort?: number } }) {
        return { method: request.method, url: routeLogUrl(request), hostname: clip(request.hostname, LOG_HOSTNAME_MAX), remoteAddress: request.ip, remotePort: request.socket?.remotePort };
      },
      // o tipo do Fastify exige type/message/stack; o conteúdo real (sem message/stack para erro do Prisma) é o de `safeError`
      err: ((error: unknown) => {
        try {
          return safeError(error);
        } catch {
          return { type: "ErroIlegivel" }; // `message`/`stack` que lançam não podem derrubar quem loga (SEC-33)
        }
      }) as unknown as (error: Error) => { type: string; message: string; stack: string },
    },
  };
}
