import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "../src/lib/mercadopago";

// MP_WEBHOOK_SECRET vem do vitest.config.ts (test-webhook-secret).
describe("verifyWebhookSignature", () => {
  function sign(dataId: string, requestId: string, ts: string, secret: string) {
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    return createHmac("sha256", secret).update(manifest).digest("hex");
  }

  it("aceita uma assinatura válida", () => {
    const ts = String(Date.now());
    const requestId = "req-123";
    const dataId = "999888777";
    const v1 = sign(dataId, requestId, ts, "test-webhook-secret");

    const valid = verifyWebhookSignature({
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId,
      dataId,
    });
    expect(valid).toBe(true);
  });

  it("rejeita assinatura forjada (secret errado)", () => {
    const ts = String(Date.now());
    const requestId = "req-123";
    const dataId = "999888777";
    const v1 = sign(dataId, requestId, ts, "secret-errado");

    const valid = verifyWebhookSignature({
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId,
      dataId,
    });
    expect(valid).toBe(false);
  });

  it("rejeita header ausente", () => {
    const valid = verifyWebhookSignature({ signatureHeader: undefined, requestId: "req-123", dataId: "1" });
    expect(valid).toBe(false);
  });

  it("rejeita quando dataId usado na verificação é diferente do assinado", () => {
    const ts = String(Date.now());
    const requestId = "req-123";
    const v1 = sign("111", requestId, ts, "test-webhook-secret");

    const valid = verifyWebhookSignature({
      signatureHeader: `ts=${ts},v1=${v1}`,
      requestId,
      dataId: "222",
    });
    expect(valid).toBe(false);
  });
});
