import { describe, expect, it } from "vitest";
import { LOG_MAX_ENTRIES, LOG_MAX_NODES, sanitizeLogObject, scrubText } from "../src/lib/logging";

// SEC-33d: as sobras que o Deming mediu no SEC-33 (sonda `deming\entregas\qa-log-sec33.test.ts`, que aqui vira teste): formatos de segredo em TEXTO que ainda
// passavam, falso positivo em texto de pedido, custo das expressões e teto TOTAL de nós na travessia.

const casos: [string, string, string][] = [
  ["senha com aspas escapadas", 'password="ab\\"CAUDA-VAZA-1"', "CAUDA-VAZA-1"],
  ["senha JSON com \\\" no meio", '{"password":"abc\\"SEGREDO-2xyz"}', "SEGREDO-2xyz"],
  ["senha sem aspas com espaço", "password: minha frase SEGREDO-3 fim", "SEGREDO-3"],
  ["senha sem aspas com espaço, no meio de uma query", "GET /x?senha=minha frase SEGREDO-3b fim&a=1", "SEGREDO-3b"],
  ["token= solto na query do texto", "GET /x?token=SEGREDO-4&a=1", "SEGREDO-4"],
  ["Authorization sem espaço", "Authorization:Bearer SEGREDO-5abcdef", "SEGREDO-5abcdef"],
  ["authorization em minúscula + Basic", "authorization: basic U0VHUkVETy02YWJj", "U0VHUkVETy02YWJj"],
  ["cookie em JSON", '{"cookie":"sid=SEGREDO-7; a=b"}', "SEGREDO-7"],
  ["x-order-token em linha de cabeçalho", "x-order-token: SEGREDO-8abcdefgh", "SEGREDO-8abcdefgh"],
  ["apikey com hífen", "x-api-key=SEGREDO-11abc", "SEGREDO-11abc"],
  ["Proxy-Authorization", "Proxy-Authorization: Basic SEGREDO-12abc", "SEGREDO-12abc"],
  ["URL com userinfo (erro de conexão do banco)", "Can't reach database server at postgres://app:SEGREDO-13@db.interno:5432/x", "SEGREDO-13"],
  ["URL com userinfo em https", "falha em https://usuario:SEGREDO-13b@api.exemplo.com/v1", "SEGREDO-13b"],
  ["refresh_token em JSON com espaço", '{ "refresh_token" : "SEGREDO-14abc" }', "SEGREDO-14abc"],
  ["Cookie com CRLF e duas linhas", "Cookie: a=SEGREDO-15\r\nCookie: b=SEGREDO-16", "SEGREDO-16"],
];

describe("SEC-33d: formatos de segredo em texto que ainda passavam", () => {
  it.each(casos)("%s", (_nome, entrada, segredo) => {
    expect(scrubText(entrada)).not.toContain(segredo);
  });

  it("o texto em volta fica legível (só o valor some) e a URL mantém usuário e host", () => {
    expect(scrubText("Can't reach database server at postgres://app:SEGREDO@db.interno:5432/x")).toBe("Can't reach database server at postgres://app:[redigido]@db.interno:5432/x");
    expect(scrubText('{"password":"abc\\"SEGREDO-2xyz","nome":"Maria"}')).toBe('{"password":"[redigido]","nome":"Maria"}');
    expect(scrubText("GET /x?token=SEGREDO-4&pagina=2")).toBe("GET /x?token=[redigido]&pagina=2");
    expect(scrubText("password: minha frase SEGREDO-3 fim")).toBe("password: [redigido]");
  });

  it("falso positivo: texto comum de pedido e de cliente segue legível", () => {
    const ok = [
      "Pedido 0042 do cliente Autor Silva (pin do mapa) senha do wifi é aviso na porta",
      "state=aberto code=P2002 author=Maria",
      "Total R$ 12,50 - mesa 7 - observação: sem cebola, cookie de chocolate",
      "o token do pedido é gerado na criação; tokenId=abc não é segredo aqui",
      "acesse https://loja.exemplo.com/menu e https://loja.exemplo.com:8443/x sem credencial",
    ];
    expect(ok.filter((texto) => scrubText(texto) !== texto)).toEqual([]);
    const o = sanitizeLogObject({ code: "0007", state: "ABERTO", orderCode: "ABC123DEF456GHI789" }) as Record<string, string>;
    expect(o).toEqual({ code: "0007", state: "ABERTO", orderCode: "ABC123DEF456GHI789" });
  });

  it("ReDoS: 2000 caracteres adversariais em cada expressão levam < 50 ms", () => {
    const entradas: Record<string, string> = {
      aspas: 'password="' + "a ".repeat(1000),
      aspasEscapadas: 'password="' + 'a\\"'.repeat(660),
      cookie: "Cookie:" + " ".repeat(1990),
      named: "password=" + "bearer ".repeat(280),
      senhaSemAspas: "senha=" + "a b ".repeat(480),
      jwt: "eyJ" + "a".repeat(1000) + "." + "b".repeat(990),
      scheme: "bearer " + "A".repeat(1990),
      pontos: ".".repeat(2000),
      authrep: "authorization: ".repeat(140),
      url: "postgres://" + "u:".repeat(900) + "@",
      urlSemArroba: "http://" + "a".repeat(1990),
      token: "token=".repeat(330),
    };
    const t: Record<string, number> = {};
    for (const [nome, valor] of Object.entries(entradas)) {
      const t0 = performance.now();
      scrubText(valor);
      t[nome] = performance.now() - t0;
    }
    expect(Math.max(...Object.values(t)), JSON.stringify(t)).toBeLessThan(50);
  });
});

// JSON serializado DUAS vezes: o que um erro de biblioteca produz ao pôr o corpo da requisição em texto (resto (a) do Sun Tzu).
describe("SEC-33d: JSON duplamente escapado em texto", () => {
  const esc = (json: string) => json.split(String.fromCharCode(34)).join(String.fromCharCode(92, 34)); // " -> \"
  const casosEscapados: [string, string, string][] = [
    ["access_token", esc('{"access_token":"SEG-H1"}'), "SEG-H1"],
    ["password", esc('{"password":"SEG-H2","nome":"Maria"}'), "SEG-H2"],
    ["refresh_token com espaços", esc('{ "refresh_token" : "SEG-H3" }'), "SEG-H3"],
    ["cookie", esc('{"cookie":"sid=SEG-H4; a=b"}'), "SEG-H4"],
    ["client_secret no meio de um corpo maior", "falha ao chamar o provedor: " + esc('{"grant":"client_credentials","client_secret":"SEG-H5","scope":"pagamentos"}'), "SEG-H5"],
  ];
  it.each(casosEscapados)("%s", (_nome, entrada, segredo) => {
    const saida = scrubText(entrada);
    expect(saida).not.toContain(segredo);
    expect(saida).toContain("[redigido]");
  });

  it("o resto do corpo fica legível e o escape do restante não é quebrado", () => {
    const saida = scrubText(esc('{"password":"SEG-H2","nome":"Maria"}'));
    expect(saida).toBe(esc('{"password":"[redigido]","nome":"Maria"}'));
  });

  it("não cria falso positivo no JSON escapado comum (campos sem nome de segredo) e não custa caro", () => {
    const comum = esc('{"pedido":"0042","cliente":"Autor Silva","obs":"sem cebola"}');
    expect(scrubText(comum)).toBe(comum);
    const adversarial = 'password' + String.fromCharCode(92) + '"' + (String.fromCharCode(92, 34).repeat(900));
    const t0 = performance.now();
    scrubText(adversarial);
    scrubText(("token" + String.fromCharCode(92, 34, 58, 92, 34)).repeat(300));
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe("SEC-33d: teto TOTAL de nós na travessia", () => {
  function arvore(profundidade: number, largura: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (let i = 0; i < largura; i += 1) out[`k${i}`] = profundidade > 0 ? arvore(profundidade - 1, largura) : "folha";
    return out;
  }

  const contar = (valor: unknown): number => (valor && typeof valor === "object" ? 1 + Object.values(valor as object).reduce((soma: number, filho) => soma + contar(filho), 0) : 0);

  it("árvore LARGA (20 chaves × 5 níveis: 3,2 milhões de nós, 5,7 s e 9 MB antes) termina em milissegundos; o teto de ENTRADAS corta e a saída fica pequena", () => {
    const entrada = { raiz: arvore(5, 20) }; // montar a árvore fica FORA do cronômetro: só a sanitização é medida
    const t0 = performance.now();
    const out = sanitizeLogObject(entrada);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(200);
    const json = JSON.stringify(out);
    expect(json).toContain("chaves omitidas");
    expect(json.length).toBeLessThan(250_000);
    expect(contar(out)).toBeLessThanOrEqual(LOG_MAX_NODES + 2);
    // entradas = chaves de objeto na saída (cada uma custa 1): nunca passa do teto
    const entradas = (valor: unknown): number => (valor && typeof valor === "object" ? Object.values(valor as object).reduce((soma: number, filho) => soma + 1 + entradas(filho), 0) : 0);
    expect(entradas(out)).toBeLessThanOrEqual(LOG_MAX_ENTRIES + 50);
  });

  it("lista de 50 objetos de 1 chave aninhada 3 vezes (130 mil objetos, poucas entradas por objeto): o teto de NÓS corta com o marcador de omitido", () => {
    const lista = (nivel: number): unknown[] => Array.from({ length: 50 }, () => ({ k: nivel > 0 ? lista(nivel - 1) : "folha" }));
    const entrada = { raiz: lista(2) };
    const t0 = performance.now();
    const out = sanitizeLogObject(entrada);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(JSON.stringify(out)).toContain("[omitido: objeto grande demais]");
    expect(contar(out)).toBeLessThanOrEqual(LOG_MAX_NODES + 2);
  });

  it("objeto pequeno e normal não é afetado pelo teto (controle positivo)", () => {
    const out = sanitizeLogObject({ pedido: { itens: [{ nome: "X-Burger", qtd: 2 }, { nome: "Suco", qtd: 1 }], total: 3500 }, job: "tech.cleanup" });
    expect(out).toEqual({ pedido: { itens: [{ nome: "X-Burger", qtd: 2 }, { nome: "Suco", qtd: 1 }], total: 3500 }, job: "tech.cleanup" });
  });
});
