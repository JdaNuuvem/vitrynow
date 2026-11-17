import { beforeEach, describe, expect, it } from "vitest";
import { clearResume, hasValidPixFor, parseResume, readResume, RESUME_DEFAULT_PIX_MS, RESUME_MAX_AGE_MS, resumeKey, saveResume } from "./pixResume";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const pix = { pixQrCode: "00020126580014br.gov.bcb.pix0136abcd", pixQrCodeBase64: "QUJDREVG" };
const order = { code: "0123", totalCents: 4500, placedAt: NOW, pix, pixExpiresAt: NOW + 30 * 60_000 };
const valid = () => ({ v: 1, code: "0123", placedAt: NOW, totalCents: 4500, paymentMethod: "PIX", pix: { ...pix }, pixExpiresAt: NOW + 30 * 60_000, pixExpiryKnown: true });

beforeEach(() => sessionStorage.clear());

describe("pixResume: o que é guardado (UI-V-23)", () => {
  it("só código, hora, total, paymentMethod, payload do PIX e prazo; nunca token, orderId nem dado do cliente", () => {
    expect(saveResume("loja", order)).toBe(true);
    const raw = sessionStorage.getItem(resumeKey("loja")) as string;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["code", "paymentMethod", "pix", "pixExpiresAt", "pixExpiryKnown", "placedAt", "totalCents", "v"]);
    expect(Object.keys(JSON.parse(raw).pix).sort()).toEqual(["pixQrCode", "pixQrCodeBase64"]);
    expect(raw).not.toMatch(/token|orderId|mco_|customer|phone|name|address/i);
  });

  it("uma chave por loja, só em sessionStorage (nunca localStorage)", () => {
    saveResume("loja-a", order);
    saveResume("loja-b", { ...order, code: "0999" });
    expect(sessionStorage.length).toBe(2);
    expect(localStorage.length).toBe(0);
    expect(JSON.parse(sessionStorage.getItem(resumeKey("loja-a")) as string).code).toBe("0123");
  });

  it("sem payload (pedido em dinheiro) não grava nada", () => {
    expect(saveResume("loja", { ...order, pix: null })).toBe(false);
    expect(saveResume("loja", { ...order, pix: { pixQrCode: null, pixQrCodeBase64: null } })).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it("sem prazo da API o QR só some pelo teto de 24 h (nunca um prazo menor inventado) e fica MARCADO como não informado pelo servidor", () => {
    saveResume("loja", { ...order, pixExpiresAt: null });
    const saved = JSON.parse(sessionStorage.getItem(resumeKey("loja")) as string);
    expect(saved.pixExpiresAt).toBe(NOW + RESUME_DEFAULT_PIX_MS);
    expect(saved.pixExpiryKnown).toBe(false);
  });

  it("com prazo da API, fica marcado como informado pelo servidor", () => {
    saveResume("loja", order);
    expect(JSON.parse(sessionStorage.getItem(resumeKey("loja")) as string).pixExpiryKnown).toBe(true);
  });

  it("o que não passa no esquema de leitura nem é gravado (código com HTML)", () => {
    expect(saveResume("loja", { ...order, code: "<script>" })).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it("storage cheio ou bloqueado: não quebra, só não grava", () => {
    const broken = { setItem: () => { throw new Error("cheio"); } } as unknown as Storage;
    expect(saveResume("loja", order, broken)).toBe(false);
    expect(saveResume("loja", order, null)).toBe(false);
  });
});

describe("pixResume: leitura com validação do objeto inteiro (UI-V-28)", () => {
  const read = () => readResume("loja", NOW + 60_000);
  const store = (value: unknown) => sessionStorage.setItem(resumeKey("loja"), typeof value === "string" ? value : JSON.stringify(value));

  it("chave válida volta inteira", () => {
    saveResume("loja", order);
    const reading = read();
    expect(reading?.kind).toBe("valid");
    expect(reading?.kind === "valid" && reading.record).toMatchObject({ code: "0123", totalCents: 4500, paymentMethod: "PIX", pix });
  });

  it.each([
    ["método inventado", { ...valid(), paymentMethod: "BOLETO" }],
    ["método em minúsculas", { ...valid(), paymentMethod: "pix" }],
    ["total em texto", { ...valid(), totalCents: "4500" }],
    ["total negativo", { ...valid(), totalCents: -1 }],
    ["total com centavos quebrados", { ...valid(), totalCents: 10.5 }],
    ["campo extra na raiz (token)", { ...valid(), token: "mco_x" }],
    ["campo extra na raiz (orderId)", { ...valid(), orderId: "ord-1" }],
    ["campo extra no payload", { ...valid(), pix: { ...pix, orderId: "ord-1" } }],
    ["payload com método OUTRO", { ...valid(), paymentMethod: "OUTRO" }],
    ["PIX sem payload", { ...valid(), pix: null }],
    ["PIX sem prazo", { ...valid(), pixExpiresAt: null }],
    ["prazo antes do pedido", { ...valid(), pixExpiresAt: NOW - 1000 }],
    ["prazo igual à hora do pedido", { ...valid(), pixExpiresAt: NOW }],
    ["prazo mais de 24 h depois do pedido", { ...valid(), pixExpiresAt: NOW + RESUME_MAX_AGE_MS + 1 }],
    ["PIX sem a marca do prazo", (() => { const { pixExpiryKnown: _k, ...rest } = valid(); return rest; })()],
    ["marca do prazo em texto", { ...valid(), pixExpiryKnown: "true" }],
    ["prazo em texto", { ...valid(), pixExpiresAt: "2026-11-17T12:30:00Z" }],
    ["código com HTML", { ...valid(), code: "<img src=x onerror=alert(1)>" }],
    ["código longo demais", { ...valid(), code: "1".repeat(17) }],
    ["código vazio", { ...valid(), code: "" }],
    ["copia e cola com caractere de controle", { ...valid(), pix: { ...pix, pixQrCode: "0002\u0000" } }],
    ["copia e cola fora de ASCII", { ...valid(), pix: { ...pix, pixQrCode: "pagué" } }],
    ["QR com aspas (injeção na data: URL)", { ...valid(), pix: { ...pix, pixQrCodeBase64: 'AAAA" onerror="x' } }],
    ["QR com esquema javascript", { ...valid(), pix: { ...pix, pixQrCodeBase64: "javascript:alert(1)" } }],
    ["QR gigante", { ...valid(), pix: { ...pix, pixQrCodeBase64: "A".repeat(40_001) } }],
    ["versão do esquema errada", { ...valid(), v: 2 }],
    ["sem versão", (() => { const { v: _v, ...rest } = valid(); return rest; })()],
    ["lista em vez de objeto", [valid()]],
    ["texto solto", "isto não é JSON"],
    ["null", "null"],
    ["JSON quebrado", '{"v":1,'],
  ])("%s ⇒ a chave INTEIRA é descartada e nada é devolvido", (_name, value) => {
    store(value);
    expect(read()).toBeNull();
    expect(sessionStorage.getItem(resumeKey("loja"))).toBeNull();
  });

  it("parseResume não devolve nada para __proto__ nem para tipos estranhos", () => {
    expect(parseResume(JSON.parse('{"__proto__":{"x":1},"v":1}'))).toBeNull();
    expect(parseResume(undefined)).toBeNull();
    expect(parseResume(42)).toBeNull();
  });

  it("parseResume rejeita DIRETO: método fora da lista e payload junto de OUTRO (a rejeição não pode depender da leitura)", () => {
    expect(parseResume({ ...valid(), paymentMethod: "BOLETO" })).toBeNull();
    expect(parseResume({ ...valid(), paymentMethod: "OUTRO" })).toBeNull(); // OUTRO com payload e prazo = adulteração
    expect(parseResume({ v: 1, code: "0123", placedAt: NOW, totalCents: 4500, paymentMethod: "OUTRO" })).not.toBeNull();
    expect(parseResume({ v: 1, code: "0123", placedAt: NOW, totalCents: 4500, paymentMethod: "OUTRO", pix })).toBeNull(); // só o payload
    expect(parseResume({ v: 1, code: "0123", placedAt: NOW, totalCents: 4500, paymentMethod: "OUTRO", pixExpiresAt: NOW + 1 })).toBeNull(); // só o prazo
    expect(parseResume({ v: 1, code: "0123", placedAt: NOW, totalCents: 4500, paymentMethod: "OUTRO", pixExpiryKnown: true })).toBeNull(); // só a marca
    expect(parseResume({ ...valid(), pix: { ...pix, pixQrCodeBase64: 'AAAA" onerror="x' } })).toBeNull();
    expect(parseResume({ ...valid(), pix: { ...pix, pixQrCodeBase64: "javascript:alert(1)" } })).toBeNull();
  });

  it("QR em branco (null) é aceito: só o copia e cola", () => {
    expect(parseResume({ ...valid(), pix: { pixQrCode: pix.pixQrCode, pixQrCodeBase64: null } })).not.toBeNull();
  });
});

describe("pixResume: validade", () => {
  it("PIX vencido: devolve 'expired' com o código e APAGA a chave", () => {
    saveResume("loja", order);
    const reading = readResume("loja", NOW + 31 * 60_000);
    expect(reading).toEqual({ kind: "expired", code: "0123" });
    expect(sessionStorage.getItem(resumeKey("loja"))).toBeNull();
    expect(readResume("loja", NOW + 31 * 60_000)).toBeNull(); // 2ª leitura: nada
  });

  it("sem prazo da API (reserva de 24 h) a chave continua valendo até perto do teto, sem hora inventada de 30 min", () => {
    saveResume("loja", { ...order, pixExpiresAt: null });
    expect(readResume("loja", NOW + 31 * 60_000)?.kind).toBe("valid");
    expect(readResume("loja", NOW + 23 * 3_600_000)?.kind).toBe("valid");
  });

  it("no segundo exato do prazo já vale como vencido", () => {
    saveResume("loja", order);
    expect(readResume("loja", order.pixExpiresAt)?.kind).toBe("expired");
  });

  it("mais de 24 h: some sem tela (null) e apaga", () => {
    saveResume("loja", { ...order, pixExpiresAt: NOW + RESUME_MAX_AGE_MS });
    expect(readResume("loja", NOW + RESUME_MAX_AGE_MS + 1)).toBeNull();
    expect(sessionStorage.getItem(resumeKey("loja"))).toBeNull();
  });

  it("hora do pedido no futuro (relógio adulterado) é descartada", () => {
    saveResume("loja", { ...order, placedAt: NOW + 3_600_000, pixExpiresAt: NOW + 7_200_000 });
    expect(readResume("loja", NOW)).toBeNull();
    expect(sessionStorage.getItem(resumeKey("loja"))).toBeNull();
  });

  it("chave de OUTRO método (sem QR) não retoma nada e é apagada", () => {
    sessionStorage.setItem(resumeKey("loja"), JSON.stringify({ v: 1, code: "0123", placedAt: NOW, totalCents: 4500, paymentMethod: "OUTRO" }));
    expect(readResume("loja", NOW + 1000)).toBeNull();
    expect(sessionStorage.getItem(resumeKey("loja"))).toBeNull();
  });

  it("sem chave guardada: null (estado vazio normal)", () => {
    expect(readResume("loja", NOW)).toBeNull();
  });

  it("storage que lança ao ler não quebra a tela", () => {
    const broken = { getItem: () => { throw new Error("bloqueado"); }, removeItem: () => {} } as unknown as Storage;
    expect(readResume("loja", NOW, broken)).toBeNull();
    expect(readResume("loja", NOW, null)).toBeNull();
  });

  it("clearResume apaga só a chave da loja", () => {
    saveResume("a", order);
    saveResume("b", order);
    clearResume("a");
    expect(sessionStorage.getItem(resumeKey("a"))).toBeNull();
    expect(sessionStorage.getItem(resumeKey("b"))).not.toBeNull();
  });

  it("hasValidPixFor: só para o mesmo código e com payload válido", () => {
    saveResume("loja", order);
    const reading = readResume("loja", NOW + 1000);
    expect(hasValidPixFor(reading, "0123")).toBe(true);
    expect(hasValidPixFor(reading, "0124")).toBe(false);
    expect(hasValidPixFor(null, "0123")).toBe(false);
    expect(hasValidPixFor({ kind: "expired", code: "0123" }, "0123")).toBe(false);
  });
});
