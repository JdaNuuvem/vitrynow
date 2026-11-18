import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Menu } from "@/core/domain/storefront";
import { getMenuOnServer, MAX_STALE_SECONDS, resetServerMenuState } from "./serverMenu";

// PEN-02 / SEC-26 (Sun Tzu) — o cache da página é testado com um unstable_cache FIEL ao do Next 14:
// entrada nova ⇒ executa e grava; entrada vencida ⇒ DEVOLVE A CÓPIA VELHA NA HORA e revalida em segundo plano
// (se a revalidação lançar, a cópia antiga fica; se retornar, substitui). O duplo dos testes da Tesla nunca vence
// nem serve cópia velha, então não enxerga estes cenários. Adotado da PEN-02 do Sun Tzu como teste fixo (SEC-27). Sem banco e sem build.

type Entry = { v: unknown; at: number };
const store = new Map<string, Entry>();
const pending: Promise<unknown>[] = [];

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[], options: { revalidate?: number }) => {
    return async () => {
      const key = keyParts.join("|");
      const entry = store.get(key);
      const now = Date.now();
      if (!entry) {
        const v = await fn(); // primeira vez: bloqueia; se lançar, propaga e não grava
        store.set(key, { v, at: Date.now() });
        return v;
      }
      if (now - entry.at > (options.revalidate ?? 0) * 1000) {
        // vencida: serve a velha agora, revalida depois
        pending.push(
          fn()
            .then((v) => store.set(key, { v, at: Date.now() }))
            .catch(() => {}),
        );
      }
      return entry.v;
    };
  },
}));

const menu = { store: { name: "Pizzaria Boa", slug: "boa", address: "Rua A, 1", openingHours: "18h" }, categories: [{ id: "c", name: "P", icon: null, products: [{ id: "p" }] }] } as unknown as Menu;
type Api = { status: number; body?: unknown };
let api: Api = { status: 200, body: menu };
const fetchMock = vi.fn(async () => ({ status: api.status, ok: api.status >= 200 && api.status < 300, json: async () => api.body }));

async function visita(slug = "boa") {
  const r = await getMenuOnServer(slug);
  await Promise.allSettled(pending.splice(0)); // deixa a revalidação em segundo plano terminar
  return r.status;
}
const avancar = (segundos: number) => vi.setSystemTime(Date.now() + segundos * 1000);

describe("PEN-02 · cache ISR do cardápio com SWR do Next (SEC-25/SEC-26)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    store.clear();
    pending.length = 0;
    resetServerMenuState();
    api = { status: 200, body: menu };
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ISR-a (controle): API saudável, visitas a cada 20 s ⇒ sempre 'ok'", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await visita()).toBe("ok");
      avancar(20);
    }
  });

  it("ISR-b: loja suspensa fecha em ≤ 1 visita depois do vencimento e não reabre sozinha", async () => {
    expect(await visita()).toBe("ok");
    api = { status: 503, body: { code: "STORE_UNAVAILABLE" } };
    avancar(31);
    const v1 = await visita(); // ainda pode ser a cópia velha (uma visita, aceito)
    const v2 = await visita();
    const v3 = await visita();
    expect(["ok", "suspended"]).toContain(v1);
    expect([v2, v3]).toEqual(["suspended", "suspended"]);
  });

  it("ISR-c: API fora por 12 min ⇒ a cópia boa serve até o teto de 10 min e depois falha fechada como 'unavailable' (sem dados)", async () => {
    expect(await visita()).toBe("ok");
    api = { status: 500 };
    const vistos: string[] = [];
    for (let t = 40; t <= 12 * 60; t += 40) {
      avancar(40);
      vistos.push(await visita());
    }
    const idadeTeto = Math.ceil(MAX_STALE_SECONDS / 40);
    expect(vistos.slice(0, idadeTeto - 2).every((s) => s === "ok")).toBe(true);
    expect(vistos[vistos.length - 1]).toBe("unavailable"); // passou do teto: ST-52, nunca "suspended"
  });

  it("ISR-d (IDLE): API saudável, ninguém visita por 11 min; o PRIMEIRO visitante depois NÃO pode ver 'Loja indisponível'", async () => {
    expect(await visita()).toBe("ok"); // cópia gravada às 12:00
    avancar(11 * 60); // loja pequena: ninguém abre o cardápio por 11 min; a API continua ótima
    const primeiro = await visita();
    expect(primeiro).toBe("ok");
  });

  it("ISR-e (IDLE longo): de manhã, 8 h depois da última visita, o primeiro visitante vê o cardápio (não 'indisponível')", async () => {
    expect(await visita()).toBe("ok");
    avancar(8 * 3600);
    expect(await visita()).toBe("ok");
  });

  it("ISR-f: loja REMOVIDA com o processo reiniciado (memória vazia, cópia boa ainda no disco) deixa de aparecer em até 1 visita e não reaparece", async () => {
    expect(await visita()).toBe("ok");
    resetServerMenuState(); // o processo do web reiniciou: seenOk e mapas de memória vazios; a cópia no disco ficou
    api = { status: 404, body: { error: "loja não encontrada" } };
    avancar(40);
    const vistos: string[] = [];
    for (let i = 0; i < 12; i++) {
      vistos.push(await visita());
      avancar(40);
    }
    const oks = vistos.filter((s) => s === "ok").length;
    expect(oks, vistos.join(",")).toBeLessThanOrEqual(1);
  });

  it("ISR-g: um slug válido que NÃO é loja, visitado 200 vezes em 20 s, chama a API 1 vez e não grava nada no cache", async () => {
    for (let i = 0; i < 200; i++) {
      api = { status: 404, body: {} };
      await getMenuOnServer("fantasma");
      avancar(0.1);
    }
    await Promise.allSettled(pending.splice(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });
  // ST-54: voo único. No Next real a página de ISR já junta renderizações; isto protege se a rota virar dinâmica.
  it("ISR-h: 100 visitantes chegam JUNTOS depois de 11 min de ociosidade ⇒ a API não recebe uma chamada por visitante (voo único)", async () => {
    expect(await visita()).toBe("ok");
    avancar(11 * 60);
    fetchMock.mockClear();
    const rs = await Promise.all(Array.from({ length: 100 }, () => getMenuOnServer("boa")));
    await Promise.allSettled(pending.splice(0));
    expect(rs.every((r) => r.status === "ok")).toBe(true);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it("ISR-i: cópia velha demais + API em 429 (balde esgotado) ⇒ fecha como 'unavailable' (sem dados da loja) e não como 'ok' nem 'suspended'", async () => {
    expect(await visita()).toBe("ok");
    api = { status: 429, body: { error: "Too Many Requests" } };
    avancar(11 * 60);
    const r = await getMenuOnServer("boa");
    await Promise.allSettled(pending.splice(0));
    expect(r.status).toBe("unavailable");
    expect(JSON.stringify(r)).not.toContain("Pizzaria");
  });

  it("ISR-j: loja SUSPENSA com cópia velha demais e API em 503 STORE_UNAVAILABLE ⇒ 'suspended' na hora, sem dados", async () => {
    expect(await visita()).toBe("ok");
    api = { status: 503, body: { code: "STORE_UNAVAILABLE" } };
    avancar(11 * 60);
    const r = await getMenuOnServer("boa");
    await Promise.allSettled(pending.splice(0));
    expect(r.status).toBe("suspended");
    expect(JSON.stringify(r)).not.toContain("Pizzaria");
  });
});
