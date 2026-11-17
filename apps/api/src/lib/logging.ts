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

export function loggerOptions() {
  return { redact: { paths: REDACT_PATHS, censor: "[redigido]" } };
}
