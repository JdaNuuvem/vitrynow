// API-47 / ADR-0009 §2 — o hub entrega por AUDIÊNCIA: `device` só recebe print.available e ping; o painel recebe o resto; lojas isoladas.
import { describe, expect, it, vi } from "vitest";
import { WS_AUDIENCE, wsServerMessageSchema, type WsServerMessage } from "@meucardapio/shared-types";
import { publishToPanel, publishToStore, subscribe, type SocketRole } from "../src/realtime/hub";

const SAMPLES: WsServerMessage[] = [
  { type: "order.created", orderId: "o" },
  { type: "order.updated", orderId: "o" },
  { type: "order.cancel_notice", orderId: "o" },
  { type: "payment.refund_pending", orderId: "o" },
  { type: "payment.refund_done", orderId: "o" },
  { type: "payment.reconcile_needed", orderId: "o" },
  { type: "print.available" },
  { type: "print.job_failed", jobId: "j", code: "NO_PAPER" },
  { type: "print.claimed", jobId: "j" },
  { type: "print.printed", jobId: "j", orderId: "o" },
  { type: "print.stale", count: 2 },
  { type: "cashier.difference_over_tolerance", sessionId: "s" },
  { type: "device.alert", code: "MODE_UNCONFIRMED" },
  { type: "ping" },
];

function connect(storeId: string, role: SocketRole) {
  const sent: string[] = [];
  subscribe(storeId, { readyState: 1, OPEN: 1, send: (m: string) => sent.push(m), on: vi.fn() } as never, role);
  return () => sent.map((m) => JSON.parse(m).type as string);
}

describe("API-47 — hub WS por audiência", () => {
  it("contrato: TODO tipo do schema declara audiência (e as amostras cobrem todos os tipos)", () => {
    const types = wsServerMessageSchema.options.map((o) => o.shape.type.value).sort();
    expect(Object.keys(WS_AUDIENCE).sort()).toEqual(types);
    expect(SAMPLES.map((m) => m.type).sort()).toEqual(types);
    for (const m of SAMPLES) expect(wsServerMessageSchema.safeParse(m).success, m.type).toBe(true);
  });

  it("o dispositivo NUNCA recebe order.*, payment.*, cashier.*, device.alert nem print.* além de print.available (e ping)", () => {
    const device = connect("loja-ws-1", "DEVICE");
    for (const m of SAMPLES) publishToStore("loja-ws-1", m);
    expect(device()).toEqual(["print.available", "ping"]);
  });

  it("o painel (OWNER) recebe todos os tipos; o STAFF recebe os mesmos menos os de dono (caixa, alertas de dinheiro)", () => {
    const owner = connect("loja-ws-2", "OWNER");
    const staff = connect("loja-ws-2", "STAFF");
    for (const m of SAMPLES) publishToStore("loja-ws-2", m);
    expect(owner()).toEqual(SAMPLES.map((m) => m.type));
    expect(staff()).toEqual(SAMPLES.map((m) => m.type).filter((t) => t !== "cashier.difference_over_tolerance"));
  });

  it("publishToPanel não alcança a impressora nem com tipo `both`", () => {
    const device = connect("loja-ws-3", "DEVICE");
    const owner = connect("loja-ws-3", "OWNER");
    publishToPanel("loja-ws-3", { type: "print.available" });
    expect(device()).toEqual([]);
    expect(owner()).toEqual(["print.available"]);
  });

  it("isolamento: nada da loja A chega ao painel ou à impressora da loja B", () => {
    const ownerB = connect("loja-ws-B", "OWNER");
    const deviceB = connect("loja-ws-B", "DEVICE");
    const deviceA = connect("loja-ws-A", "DEVICE");
    for (const m of SAMPLES) publishToStore("loja-ws-A", m);
    expect(ownerB()).toEqual([]);
    expect(deviceB()).toEqual([]);
    expect(deviceA()).toEqual(["print.available", "ping"]);
  });

  it("papel desconhecido (fail-closed) não recebe tipo de painel", () => {
    const x = connect("loja-ws-4", "BOGUS" as SocketRole);
    publishToStore("loja-ws-4", { type: "order.created", orderId: "o" });
    expect(x()).toEqual([]);
  });
});
