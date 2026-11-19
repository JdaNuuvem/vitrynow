import Fastify, { type FastifyServerOptions } from "fastify";
import { prisma } from "@meucardapio/db";
import { nanoid } from "nanoid";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import authPlugin from "./plugins/auth";
import { withTextTooLongCode } from "./lib/textErrors";
import healthRoutes from "./routes/health";
import authRoutes from "./routes/auth";
import storefrontRoutes from "./routes/storefront";
import tableRoutes from "./routes/tables";
import orderRoutes from "./modules/orders/orders.module";
import manualOrderRoutes from "./routes/manualOrders";
import deviceRoutes from "./routes/device";
import printJobRoutes from "./modules/printJobs/printJobs.module";
import deviceAlertRoutes from "./modules/deviceAlerts/deviceAlerts.module";
import deviceTokenRoutes from "./modules/deviceTokens/deviceTokens.module";
import realtimeRoutes from "./routes/realtime";
import catalogRoutes from "./modules/catalog/catalog.module";
import catalogImportRoutes from "./modules/catalogImport/catalogImport.module";
import mediaRoutes from "./modules/media/media.module";
import cashierRoutes from "./routes/cashier";
import couponRoutes from "./modules/coupons/coupons.module";
import paymentRoutes from "./modules/payments/payments.module";
import storeRoutes from "./routes/store";
import menuCampaignRoutes from "./routes/menuCampaign";
import delivererRoutes from "./modules/deliverers/deliverers.module";
import reportRoutes from "./routes/reports";
import userRoutes from "./modules/users/users.module";
import auditRoutes from "./modules/audit/audit.module";
import feedbackRoutes from "./routes/feedback";
import privacyRoutes from "./modules/privacy/privacy.module";
import subscriptionRoutes from "./routes/subscription";
import noticeRoutes from "./routes/notices";
import platformAuthPlugin from "./plugins/platformAuth";
import platformRoutes from "./routes/platform";
import mfaRoutes from "./routes/mfa";
import deliveryZoneRoutes from "./routes/deliveryZones";
import onboardingRoutes from "./routes/onboarding";
import { clientKey } from "./lib/clientKey";
import { captchaMode } from "./lib/captcha";
import { isPrismaError, loggerOptions, redactLogUrl } from "./lib/logging";
import { ORDER_TOKEN_HEADER } from "./lib/orderToken";
import { currentKey } from "./lib/paymentCrypto";
import { assertPaymentsBootConfig } from "./modules/storePayments/oauth";
import { allowedOrigin, internalServiceSecrets, trustProxySetting } from "./lib/securityConfig";
import { rateLimitKey, rateLimitMax } from "./lib/clientIp";
import jobsPlugin from "./jobs/plugin";
import pixAvailabilityPlugin from "./plugins/pixAvailability";
import storePaymentRoutes from "./modules/storePayments/storePayments.module";
import subscriptionGate from "./plugins/subscriptionGate";
import storeHoursRoutes from "./modules/storeHours/storeHours.module";
import optionGroupRoutes from "./modules/optionGroups/optionGroups.module";
import { assertStorageBootConfig } from "./lib/objectStorage";
import menuRevalidationPlugin from "./plugins/menuRevalidation";

export function buildApp(options: { logger?: FastifyServerOptions["logger"] } = {}) {
  captchaMode(); // NG-08: modo inválido, ou `fake` fora de dev/teste, derruba o boot
  const serviceSecrets = internalServiceSecrets(); // SEC-24: em produção, sem segredo de serviço válido a API nem sobe
  // trustProxy só para a(s) rede(s) do Caddy (TRUST_PROXY_CIDR): request.ip vira o cliente real
  // e o rate limit deixa de contar o IP do proxy. Vazio = ignora X-Forwarded-For (não forjável).
  // Pagamentos por loja: modo/credenciais/chave inválidos derrubam o boot (não o 1º PIX). `code`/`state` do OAuth saem do log pelo `redactLogUrl` do SEC-31.
  assertPaymentsBootConfig(process.env, currentKey);
  assertStorageBootConfig(process.env); // API-18: produção sem S3 configurado não sobe (nada de Fake em memória silencioso)
  // ST-76: o id padrão do Fastify é um contador sequencial (`req-1`, `req-2`…) e o 5xx devolve esse id ao cliente (ST-75): dois erros espaçados
  // mediriam o tráfego da API desde o boot. Id aleatório curto, e `requestIdHeader: false` para NÃO aceitar o `request-id` do cliente como id do log.
  const app = Fastify({
    logger: options.logger ?? (process.env.NODE_ENV !== "test" ? loggerOptions() : false),
    trustProxy: trustProxySetting(),
    genReqId: () => nanoid(12),
    requestIdHeader: false,
  });

  // SEC-24: uma linha por subida diz se o segredo de serviço está ligado (nunca o valor).
  app.log.info({ serviceSecretCount: serviceSecrets.length }, serviceSecrets.length > 0 ? "serviço interno: ligado" : "serviço interno: desligado (none ou ausente)");

  // app.close() (graceful shutdown) também desconecta o Prisma — ele é um singleton
  // importado direto de @meucardapio/db, não um plugin fastify com ciclo de vida próprio.
  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  // 404 de rota inexistente: o tratador padrão do Fastify grava "Route METHOD:/url?query not found" no log com a query INTEIRA
  // (token, code e state do OAuth incluídos). Mesmo corpo de resposta, sem esse log e com os valores sensíveis trocados.
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ message: `Route ${request.method}:${redactLogUrl(request.url)} not found`, error: "Not Found", statusCode: 404 });
  });

  // SEC-31 (ST-71): erro 5xx (e QUALQUER erro do Prisma) nunca vai para o log nem para a resposta com `message`/`stack`: a mensagem do Prisma
  // renderiza a chamada com os VALORES dos argumentos (nome, e-mail, telefone, endereço) e o caminho do arquivo do servidor. O log leva o erro
  // reduzido (`safeError`: código, tabela/campo, operação) com mensagem FIXA; o cliente recebe um corpo genérico. Erros abaixo de 500 (validação,
  // limite de taxa) seguem o tratamento padrão do Fastify. Os tratadores de DomainError dos módulos delegam para cá com `reply.send(error)`.
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (isPrismaError(error) || status === undefined || status >= 500) {
      const code = status !== undefined && status >= 500 ? status : 500;
      request.log.error({ req: request, err: error }, "erro interno não tratado"); // `req` = método, MODELO da rota e query redigida
      // ST-75: `error` é o texto que o web mostra (FetchHttpClient lê `payload.error`), então vai em português; `requestId` é o mesmo `reqId` gravado
      // em toda linha de log da requisição, para o suporte ligar a queixa do cliente à linha.
      return reply.code(code).send({ statusCode: code, error: "Erro interno do servidor. Tente de novo.", message: "Erro interno do servidor", requestId: request.id });
    }
    return reply.send(error);
  });

  // API-49: código TEXT_TOO_LONG nos 400 de validação. Hook SÍNCRONO (com `done`) de propósito: um onSend assíncrono atrasa o
  // `reply.sent`, e os guardas que fazem `reply.code(403).send(...)` sem `return` (requireOwner etc.) deixariam a rota seguir.
  app.addHook("onSend", (_request, reply, payload, done) => {
    done(null, reply.statusCode === 400 && typeof payload === "string" ? withTextTooLongCode(payload) : payload);
  });

  app.register(cors, {
    origin: allowedOrigin(),
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    // Lista explícita (NG-16): só estes cabeçalhos de requisição passam no preflight do navegador.
    allowedHeaders: ["content-type", ORDER_TOKEN_HEADER, "x-mfa-challenge", "x-device-token", "idempotency-key"],
  });
  // API JSON pura — CSP não se aplica a respostas que o browser nunca renderiza como HTML.
  app.register(helmet, { contentSecurityPolicy: false });
  // Teto global por IP; rotas sensíveis (login, cadastro, pedido público, webhook) têm limites
  // mais estritos definidos na própria rota via `config.rateLimit`.
  // SEC-23: a chave do limite é o cliente normalizado (IPv6 /64, alias IPv4-mapeado ⇒ IPv4), não o endereço cru.
  app.register(rateLimit, { max: (_request, key) => rateLimitMax(String(key)), timeWindow: "1 minute", keyGenerator: (request) => rateLimitKey(request) });
  app.register(websocket);
  app.register(authPlugin);
  app.register(platformAuthPlugin);
  app.register(jobsPlugin);
  // Portão da assinatura (Consulta/Suspensão): precisa vir ANTES de qualquer rota, pois age no `onRoute`.
  app.register(subscriptionGate);
  app.register(pixAvailabilityPlugin);
  app.register(menuRevalidationPlugin);

  // Várias rotas são "ação sem corpo" (delete, revoke) chamadas com
  // Content-Type: application/json mas sem body — o parser padrão do Fastify rejeita
  // isso. Corpo vazio vira {} em vez de erro 400.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    if (body === "" || body === undefined) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      // JSON malformado é erro do cliente (400), não falha do servidor (500).
      done(Object.assign(error as Error, { statusCode: 400 }), undefined);
    }
  });

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(storefrontRoutes);
  app.register(tableRoutes);
  app.register(orderRoutes);
  app.register(manualOrderRoutes);
  app.register(deviceRoutes);
  app.register(printJobRoutes);
  app.register(deviceAlertRoutes);
  app.register(deviceTokenRoutes);
  app.register(realtimeRoutes);
  app.register(catalogRoutes);
  app.register(catalogImportRoutes);
  app.register(mediaRoutes);
  app.register(optionGroupRoutes);
  app.register(cashierRoutes);
  app.register(couponRoutes);
  app.register(paymentRoutes);
  app.register(storeRoutes);
  app.register(menuCampaignRoutes);
  app.register(delivererRoutes);
  app.register(reportRoutes);
  app.register(userRoutes);
  app.register(auditRoutes);
  app.register(feedbackRoutes);
  app.register(privacyRoutes);
  app.register(subscriptionRoutes);
  app.register(storePaymentRoutes);
  app.register(storeHoursRoutes);
  app.register(noticeRoutes);
  app.register(platformRoutes);
  app.register(mfaRoutes);
  app.register(deliveryZoneRoutes);
  app.register(onboardingRoutes);

  return app;
}
