import Fastify, { type FastifyServerOptions } from "fastify";
import { prisma } from "@meucardapio/db";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import authPlugin from "./plugins/auth";
import healthRoutes from "./routes/health";
import authRoutes from "./routes/auth";
import storefrontRoutes from "./routes/storefront";
import orderRoutes from "./modules/orders/orders.module";
import deviceRoutes from "./routes/device";
import printJobRoutes from "./modules/printJobs/printJobs.module";
import deviceAlertRoutes from "./modules/deviceAlerts/deviceAlerts.module";
import deviceTokenRoutes from "./modules/deviceTokens/deviceTokens.module";
import realtimeRoutes from "./routes/realtime";
import catalogRoutes from "./modules/catalog/catalog.module";
import cashierRoutes from "./routes/cashier";
import couponRoutes from "./modules/coupons/coupons.module";
import paymentRoutes from "./modules/payments/payments.module";
import storeRoutes from "./routes/store";
import delivererRoutes from "./modules/deliverers/deliverers.module";
import reportRoutes from "./routes/reports";
import userRoutes from "./modules/users/users.module";
import auditRoutes from "./modules/audit/audit.module";
import feedbackRoutes from "./routes/feedback";
import subscriptionRoutes from "./routes/subscription";
import noticeRoutes from "./routes/notices";
import mfaRoutes from "./routes/mfa";
import { allowedOrigin, trustProxySetting } from "./lib/securityConfig";
import { clientKey } from "./lib/clientKey";
import { loggerOptions, redactLogUrl } from "./lib/logging";
import { ORDER_TOKEN_HEADER } from "./lib/orderToken";
import jobsPlugin from "./jobs/plugin";

export function buildApp(options: { logger?: FastifyServerOptions["logger"] } = {}) {
  // trustProxy só para a(s) rede(s) do Caddy (TRUST_PROXY_CIDR): request.ip vira o cliente real
  // e o rate limit deixa de contar o IP do proxy. Vazio = ignora X-Forwarded-For (não forjável).
  const app = Fastify({ logger: options.logger ?? (process.env.NODE_ENV !== "test" ? loggerOptions() : false), trustProxy: trustProxySetting() });

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

  app.register(cors, {
    origin: allowedOrigin(),
    credentials: true,
    // Lista explícita (NG-16): só estes cabeçalhos de requisição passam no preflight do navegador.
    allowedHeaders: ["content-type", ORDER_TOKEN_HEADER, "x-mfa-challenge"],
  });
  // API JSON pura — CSP não se aplica a respostas que o browser nunca renderiza como HTML.
  app.register(helmet, { contentSecurityPolicy: false });
  // Teto global por IP; rotas sensíveis (login, cadastro, pedido público, webhook) têm limites
  // mais estritos definidos na própria rota via `config.rateLimit`.
  // SEC-23: a chave do limite é o cliente normalizado (IPv6 /64, alias IPv4-mapeado ⇒ IPv4), não o endereço cru.
  app.register(rateLimit, { max: 300, timeWindow: "1 minute", keyGenerator: (request) => clientKey(request.ip) });
  app.register(websocket);
  app.register(authPlugin);
  app.register(jobsPlugin);

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
  app.register(orderRoutes);
  app.register(deviceRoutes);
  app.register(printJobRoutes);
  app.register(deviceAlertRoutes);
  app.register(deviceTokenRoutes);
  app.register(realtimeRoutes);
  app.register(catalogRoutes);
  app.register(cashierRoutes);
  app.register(couponRoutes);
  app.register(paymentRoutes);
  app.register(storeRoutes);
  app.register(delivererRoutes);
  app.register(reportRoutes);
  app.register(userRoutes);
  app.register(auditRoutes);
  app.register(feedbackRoutes);
  app.register(subscriptionRoutes);
  app.register(noticeRoutes);
  app.register(mfaRoutes);

  return app;
}
