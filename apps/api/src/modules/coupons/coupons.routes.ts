import type { FastifyPluginAsync } from "fastify";
import type { PanelRole } from "@meucardapio/shared-types";
import { createCouponSchema, updateCouponSchema } from "@meucardapio/shared-types";
import { useDomainErrors } from "../../shared/errors";
import type { CouponsService } from "./coupons.service";

// Erro de formato do cadastro com código estável do catálogo (a tela mapeia o `code`; `error` é o texto de reserva).
type ParseError = { issues: { path: (string | number)[] }[]; flatten(): { fieldErrors: unknown } };
function validationBody(error: ParseError, body: unknown) {
  const issue = error.issues[0];
  const field = String(issue?.path[0] ?? "");
  const percent = (body as { discountType?: string } | null)?.discountType === "PERCENT";
  if (field === "code") return { code: "COUPON_CODE_INVALID", error: "Use de 3 a 20 letras, números, hífen ou sublinhado." };
  if (field === "discountValue") {
    return { code: "COUPON_VALUE_INVALID", error: percent ? "O percentual vai de 1 a 100." : "Informe um valor maior que zero." };
  }
  if (field === "expiresAt") return { code: "COUPON_EXPIRY_INVALID", error: "A validade precisa ser hoje ou uma data futura." };
  if (field === "maxUses") return { code: "VALIDATION_ERROR", error: "Informe pelo menos 1 uso." };
  if (field === "minOrderCents") return { code: "VALIDATION_ERROR", error: "Informe um valor a partir de zero." };
  return { code: "VALIDATION_ERROR", error: "Dados inválidos." };
}

// CRUD de cupons — autenticado pelo painel.
export function buildCouponRoutes(service: CouponsService): FastifyPluginAsync {
  return async (app) => {
    useDomainErrors(app);
    const auth = { preHandler: app.requirePanelAuth };
    const actorOf = (request: { user: { storeId: string; userId: string; role: PanelRole } }) => ({
      storeId: request.user.storeId,
      userId: request.user.userId,
      role: request.user.role,
    });

    app.get("/api/coupons", auth, async (request) => {
      return { coupons: await service.list(request.user.storeId) };
    });

    app.post("/api/coupons", auth, async (request, reply) => {
      const parsed = createCouponSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ ...validationBody(parsed.error, request.body), fields: parsed.error.flatten().fieldErrors });
      const coupon = await service.create(actorOf(request), parsed.data);
      return reply.code(201).send({ coupon });
    });

    app.post("/api/coupons/:id", auth, async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateCouponSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ ...validationBody(parsed.error, request.body), fields: parsed.error.flatten().fieldErrors });
      return { coupon: await service.update(actorOf(request), id, parsed.data) };
    });

    app.post("/api/coupons/:id/delete", auth, async (request) => {
      const { id } = request.params as { id: string };
      await service.delete(actorOf(request), id);
      return { ok: true };
    });
  };
}
