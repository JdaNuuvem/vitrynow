import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { Prisma, prisma } from "@meucardapio/db";
import { buildApp } from "../src/app";
import { LOG_CLIENT_TEXT_MAX, LOG_HOSTNAME_MAX, LOG_MAX_DEPTH, LOG_MAX_STRING, loggerOptions, safeError, sanitizeLogObject, scrubText } from "../src/lib/logging";

// SEC-31 (ST-71, ST-72, ST-74): o log não pode levar (a) cabeçalho de autorização / campo OAuth de erro de biblioteca HTTP ou de objeto do provedor,
// (b) a mensagem do Prisma, que renderiza os VALORES da chamada (dado pessoal), nem (c) texto do cliente sem teto de tamanho.

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const app = buildApp({ logger: { ...loggerOptions(), level: "info", stream } as never });
  const parsed = () => lines.flatMap((l) => l.split("\n")).filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
  return { app, lines, parsed };
}

// erro no formato de uma biblioteca HTTP (axios/got): carrega a configuração da requisição com o cabeçalho de autorização e a resposta do provedor
function httpLibError() {
  const error = new Error("Request failed with status code 401") as Error & Record<string, unknown>;
  error.name = "AxiosError";
  error.code = "ERR_BAD_REQUEST";
  error.config = { url: "https://api.provedor.example/pagamentos", headers: { Authorization: "Bearer TOKEN-DO-PROVEDOR-9f8e7d", "x-api-key": "CHAVE-DE-API-1a2b3c" } };
  error.response = { status: 401, data: { access_token: "AT-NA-RESPOSTA-777", client_secret: "CS-NA-RESPOSTA-888" }, config: { headers: { Authorization: "Bearer OUTRO-TOKEN-5544" } } };
  error.config = { ...(error.config as object), data: '{"client_secret":"CS-NO-DATA-4455","grant":"client_credentials"}' }; // corpo da requisição em TEXTO
  error.request = { _header: "POST /oauth/token HTTP/1.1" + String.fromCharCode(13, 10) + "Authorization: Bearer HEADER-TEXT-9988" + String.fromCharCode(13, 10) }; // cabeçalho cru em TEXTO
  return error;
}
const HTTP_SECRETS = ["TOKEN-DO-PROVEDOR-9f8e7d", "CHAVE-DE-API-1a2b3c", "AT-NA-RESPOSTA-777", "CS-NA-RESPOSTA-888", "OUTRO-TOKEN-5544", "CS-NO-DATA-4455", "HEADER-TEXT-9988"];

describe("ST-72: erro de biblioteca HTTP e campos do OAuth não vão para o log", () => {
  it("`app.log.error(error)` bruto, `{ err }` e erro aninhado: nenhum segredo sai; CONTROLE POSITIVO: as linhas existem e trazem o tipo e a mensagem", async () => {
    const { app, lines, parsed } = capture();
    await app.ready();
    app.log.error(httpLibError()); // forma antiga (bruta) que ainda pode aparecer em código novo
    app.log.error({ err: httpLibError() }, "falha ao falar com o provedor");
    app.log.error({ detalhe: { err: httpLibError() } }, "erro aninhado"); // `err` fora do nível raiz: quem protege é o `redact`/serializador não alcança
    await app.close();
    const all = lines.join("\n");
    for (const secret of HTTP_SECRETS) expect(all, secret).not.toContain(secret); // inclusive o erro ANINHADO (SEC-31c)
    const bruta = parsed().find((l) => l.msg === "Request failed with status code 401")!; // `app.log.error(error)`: a mensagem do erro vira o texto da linha
    const comErr = parsed().find((l) => l.msg === "falha ao falar com o provedor")!;
    expect(bruta.err.type).toBe("AxiosError");
    expect(bruta.err.message).toBe("Request failed with status code 401");
    expect(bruta.err.config).toBeUndefined();
    expect(bruta.err.response).toBeUndefined();
    expect(comErr.msg).toBe("falha ao falar com o provedor");
    expect(JSON.stringify(comErr)).not.toContain("api.provedor.example");
  });

  it("curingas e campos do OAuth no `redact`: *.authorization, *.access_token, *.refresh_token, *.client_secret, err.config.headers.*, *.password", async () => {
    const { app, lines, parsed } = capture();
    await app.ready();
    app.log.info(
      {
        provider: { access_token: "AT-1", refresh_token: "RT-1", client_secret: "CS-1", accessToken: "AT-2", refreshToken: "RT-2", clientSecret: "CS-2", password: "PW-1" },
        res: { data: { authorization: "AUTH-1", Authorization: "AUTH-2", cookie: "COOKIE-1" } },
        outbound: { headers: { "x-api-key": "KEY-1", "X-Internal-Service-Secret": "INT-0" } },
        deep: { response: { config: { headers: { "x-api-key": "KEY-2" } } } },
        err: { config: { headers: { Authorization: "AUTH-3", "x-custom": "CUSTOM-1" } } },
        access_token: "AT-TOP",
        password: "PW-TOP",
        headers: { "x-internal-service-secret": "INT-1" },
        req: { headers: { "x-internal-service-secret": "INT-2" } },
        visivel: "texto-comum-que-fica",
      },
      "objeto do provedor",
    );
    await app.close();
    const all = lines.join("\n");
    for (const secret of ["AT-1", "RT-1", "CS-1", "AT-2", "RT-2", "CS-2", "PW-1", "AUTH-1", "AUTH-2", "COOKIE-1", "KEY-1", "KEY-2", "AUTH-3", "CUSTOM-1", "AT-TOP", "PW-TOP", "INT-0", "INT-1", "INT-2"]) {
      expect(all, secret).not.toMatch(new RegExp(`"${secret}"`));
    }
    const line = parsed().find((l) => l.msg === "objeto do provedor")!;
    expect(line.visivel).toBe("texto-comum-que-fica"); // controle positivo: o que não é segredo continua legível
    expect(line.provider.access_token).toBe("[redigido]");
    expect(line.access_token).toBe("[redigido]");
  });

  it("nenhum `log.error/warn/info(<variável de erro>)` bruto no código (a mensagem do erro viraria o texto da linha): sempre `{ err }` e mensagem fixa", () => {
    const root = join(__dirname, "..", "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts")) files.push(full);
      }
    };
    walk(root);
    const raw = /\blog\.(error|warn|info|fatal)\(\s*(error|err|e|cancelError|caught)\s*[,)]/;
    const offenders = files.filter((file) => raw.test(readFileSync(file, "utf8"))).map((file) => file.slice(root.length));
    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(20); // controle positivo: a varredura de fato leu o código
  });
});

describe("ST-71: erro do Prisma (e 5xx em geral) não leva valores nem caminho ao log nem à resposta", () => {
  const PII = "CREDENCIAL-UNICA-PII";

  it("PrismaClientValidationError SIMULADO com dado pessoal na mensagem: nenhuma linha leva o valor; o log traz tipo, operação e mensagem fixa; a resposta é genérica", async () => {
    const { app, lines, parsed } = capture();
    app.get("/simula/validacao", async () => {
      throw new Prisma.PrismaClientValidationError(
        `\nInvalid \`prisma.order.create()\` invocation in\n/srv/api/src/modules/orders/orders.service.ts:210:30\n\n  data: {\n    customerName: "${PII}",\n    customerPhone: "11999990000",\n    address: "Rua Secreta 123"\n  }\nArgument \`customerPhone\`: Invalid value provided. Expected String, provided Int.`,
        { clientVersion: "5.22.0" },
      );
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/simula/validacao" });
    await app.close();

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ statusCode: 500, error: "Erro interno do servidor. Tente de novo.", message: "Erro interno do servidor", requestId: expect.any(String) });
    // ST-75: o `requestId` da resposta é o `reqId` gravado na linha de erro (o suporte liga a queixa à linha)
    expect(parsed().find((l) => l.level === 50)!.reqId).toBe(res.json().requestId);
    const all = lines.join("\n");
    for (const secret of [PII, "11999990000", "Rua Secreta", "/srv/api/src", "orders.service.ts"]) {
      expect(all, secret).not.toContain(secret);
      expect(res.body, secret).not.toContain(secret);
    }
    // controle positivo: a linha de erro EXISTE e diz o que o diagnóstico precisa
    const errorLine = parsed().find((l) => l.level === 50)!;
    expect(errorLine.msg).toBe("erro interno não tratado");
    expect(errorLine.err.type).toBe("PrismaClientValidationError");
    expect(errorLine.err.operation).toBe("prisma.order.create");
    expect(errorLine.err.message).toBeUndefined();
    expect(errorLine.err.stack).toBeUndefined();
  });

  it("PrismaClientKnownRequestError: só `code`, `meta.target`/modelName e a operação; `meta.message` do SQL cru (traz o valor) cai, o SQLSTATE fica", async () => {
    const { app, lines, parsed } = capture();
    app.get("/simula/unico", async () => {
      throw new Prisma.PrismaClientKnownRequestError(`\nInvalid \`prisma.store.create()\` invocation in\n/srv/x.ts:1:1\nUnique constraint failed on the fields: (\`slug\`)`, {
        code: "P2002",
        clientVersion: "5.22.0",
        meta: { modelName: "Store", target: ["slug"], valor: PII },
      });
    });
    app.get("/simula/cru", async () => {
      throw new Prisma.PrismaClientKnownRequestError(`\nInvalid \`prisma.$queryRaw()\` invocation:\nRaw query failed. Code: \`22P02\`. Message: \`invalid input syntax for type integer: "${PII}"\``, {
        code: "P2010",
        clientVersion: "5.22.0",
        meta: { code: "22P02", message: `ERROR: invalid input syntax for type integer: "${PII}"` },
      });
    });
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/simula/unico" })).statusCode).toBe(500);
    expect((await app.inject({ method: "GET", url: "/simula/cru" })).statusCode).toBe(500);
    await app.close();
    expect(lines.join("\n")).not.toContain(PII);
    const [unico, cru] = parsed().filter((l) => l.level === 50);
    expect(unico.err).toMatchObject({ type: "PrismaClientKnownRequestError", code: "P2002", operation: "prisma.store.create", meta: { target: ["slug"], modelName: "Store" } });
    expect(unico.err.meta.valor).toBeUndefined(); // chave fora da lista permitida
    expect(cru.err).toMatchObject({ code: "P2010", operation: "prisma.$queryRaw", meta: { sqlState: "22P02" } });
    expect(cru.err.meta.message).toBeUndefined();
  });

  it("CASO REAL no banco: tipo inválido num create com e-mail de pessoa ⇒ a mensagem do Prisma (que traz o e-mail) não chega ao log nem à resposta", async () => {
    const { app, lines, parsed } = capture();
    app.get("/simula/real", async () => {
      await prisma.user.create({ data: { email: "pessoa-unica@exemplo.com", passwordHash: 123 as never, role: "OWNER", storeId: "x" } as never });
      return { ok: true };
    });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/simula/real" });
    await app.close();
    expect(res.statusCode).toBe(500);
    // controle positivo da PREMISSA: o erro real do Prisma de fato carrega o e-mail na mensagem (senão o teste não provaria nada)
    let raw = "";
    try {
      await prisma.user.create({ data: { email: "pessoa-unica@exemplo.com", passwordHash: 123 as never, role: "OWNER", storeId: "x" } as never });
    } catch (error) {
      raw = (error as Error).message;
    }
    expect(raw).toContain("pessoa-unica@exemplo.com");
    expect(lines.join("\n")).not.toContain("pessoa-unica");
    expect(res.body).not.toContain("pessoa-unica");
    expect(parsed().find((l) => l.level === 50)!.err.type).toBe("PrismaClientValidationError");
  });

  it("erro comum 5xx: resposta genérica (sem a mensagem do erro) e log com a mensagem fixa; erro 4xx do Fastify segue o tratamento padrão", async () => {
    const { app, parsed } = capture();
    app.get("/simula/comum", async () => {
      throw new Error("detalhe interno com 11999990000");
    });
    app.get("/simula/limite", async () => {
      throw Object.assign(new Error("muitas requisições"), { statusCode: 429 });
    });
    app.post("/simula/corpo", { schema: { body: { type: "object", required: ["a"], properties: { a: { type: "string" } } } } }, async () => ({ ok: true }));
    await app.ready();
    const comum = await app.inject({ method: "GET", url: "/simula/comum" });
    expect(comum.statusCode).toBe(500);
    expect(comum.body).not.toContain("11999990000");
    const limite = await app.inject({ method: "GET", url: "/simula/limite" });
    expect(limite.statusCode).toBe(429);
    expect(limite.json().message).toBe("muitas requisições");
    const invalido = await app.inject({ method: "POST", url: "/simula/corpo", payload: { b: 1 } });
    expect(invalido.statusCode).toBe(400);
    await app.close();
    const erro = parsed().find((l) => l.level === 50)!;
    expect(erro.msg).toBe("erro interno não tratado");
    expect(erro.err.type).toBe("Error"); // erro comum mantém tipo e mensagem para diagnóstico (o código do projeto controla o texto)
  });

  it("safeError (unidade): valor lançado que não é Error nada deixa passar; Prisma sem meta; erro comum só com a lista fixa de campos", () => {
    expect(safeError("texto com " + PII)).toEqual({ type: "NaoErro" });
    expect(safeError({ message: PII })).toEqual({ type: "NaoErro" });
    const comum = safeError(Object.assign(new Error("m"), { config: { headers: { Authorization: "X" } }, extra: PII, code: "E_X", statusCode: 502 }));
    expect(Object.keys(comum).sort()).toEqual(["code", "message", "stack", "statusCode", "type"]);
    const init = safeError(Object.assign(new Error(`Can't reach database server at \`db-interno:5432\` user ${PII}`), { name: "PrismaClientInitializationError", clientVersion: "5", errorCode: "P1001" }));
    expect(init).toMatchObject({ type: "PrismaClientInitializationError", errorCode: "P1001" });
    expect(JSON.stringify(init)).not.toContain(PII);
  });
});

describe("ST-76: o id da requisição devolvido ao cliente não é um contador nem vem do cliente", () => {
  it("dois 5xx seguidos ⇒ ids aleatórios (12 caracteres, não `req-N`, não consecutivos) que aparecem na linha de erro; `request-id`/`x-request-id` do cliente não viram o id", async () => {
    const { app, parsed } = capture();
    app.get("/simula/falha", async () => {
      throw new Error("falha interna");
    });
    await app.ready();
    const a = await app.inject({ method: "GET", url: "/simula/falha" });
    const b = await app.inject({ method: "GET", url: "/simula/falha" });
    const c = await app.inject({ method: "GET", url: "/simula/falha", headers: { "request-id": "ATACANTE-ESCOLHEU", "x-request-id": "ATACANTE-2" } });
    await app.close();
    const ids = [a, b, c].map((r) => r.json().requestId as string);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
      expect(id).not.toMatch(/^req-\d+$/);
    }
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain("ATACANTE-ESCOLHEU");
    expect(ids).not.toContain("ATACANTE-2");
    // o MESMO valor está na linha de erro correspondente (suporte liga a queixa ao log)
    const errorIds = parsed().filter((l) => l.level === 50).map((l) => l.reqId);
    expect(errorIds).toEqual(ids);
    expect(JSON.stringify(parsed())).not.toContain("ATACANTE");
  });
});

describe("SEC-31c: o log é percorrido recursivamente (erro dentro de contexto, campo OAuth fundo, segredo dentro de texto)", () => {
  it("LOG-c (Sun Tzu): erro de biblioteca HTTP DENTRO de um objeto de contexto ⇒ nenhum dos 7 segredos sai (config.data e request._header em texto incluídos); CONTROLE POSITIVO: a linha traz o tipo e a mensagem", async () => {
    const { app, lines, parsed } = capture();
    await app.ready();
    app.log.error({ ctx: { cause: httpLibError(), tentativa: 2 }, motivo: "pagamento recusado" }, "falha no provedor de pagamento");
    app.log.error({ lista: [httpLibError()] }, "erro em lista");
    await app.close();
    const all = lines.join("\n");
    for (const secret of HTTP_SECRETS) expect(all, secret).not.toContain(secret);
    const line = parsed().find((l) => l.msg === "falha no provedor de pagamento")!;
    expect(line.ctx.cause.type).toBe("AxiosError");
    expect(line.ctx.cause.message).toBe("Request failed with status code 401");
    expect(line.ctx.cause.config).toBeUndefined();
    expect(line.ctx.tentativa).toBe(2); // o que não é segredo continua legível
    expect(line.motivo).toBe("pagamento recusado");
    expect(parsed().find((l) => l.msg === "erro em lista")!.lista[0].type).toBe("AxiosError");
  });

  it("LOG-d (Sun Tzu): campo OAuth a 3, 4 e 5 níveis é redigido em qualquer profundidade e sem diferenciar caixa; o texto comum fica; além da profundidade máxima nada é impresso", async () => {
    const { app, lines, parsed } = capture();
    await app.ready();
    let fundo: Record<string, unknown> = { Client_Secret: "CS-NIVEL-FUNDO-0" };
    for (let i = 0; i < LOG_MAX_DEPTH + 2; i += 1) fundo = { filho: fundo };
    app.log.info(
      {
        dados: { prov: { client_secret: "CS-3-NIVEIS", RefreshToken: "RT-3", nivel4: { nivel5: { access_token: "AT-5", "X-Api-Key": "KEY-5" } } }, nome: "Loja do Zé" },
        fundo,
        visivel: "texto-comum-que-fica",
      },
      "oauth fundo",
    );
    await app.close();
    const all = lines.join("\n");
    for (const secret of ["CS-3-NIVEIS", "RT-3", "AT-5", "KEY-5", "CS-NIVEL-FUNDO-0"]) expect(all, secret).not.toContain(secret);
    const line = parsed().find((l) => l.msg === "oauth fundo")!;
    expect(line.visivel).toBe("texto-comum-que-fica");
    expect(line.dados.nome).toBe("Loja do Zé");
    expect(line.dados.prov.client_secret).toBe("[redigido]");
    expect(line.dados.prov.nivel4.nivel5.access_token).toBe("[redigido]");
    expect(JSON.stringify(line.fundo)).toContain("[profundo demais]");
  });

  it("segredo dentro de TEXTO (cabeçalho cru, corpo serializado, query string) é apagado; o resto do texto fica", () => {
    const crlf = String.fromCharCode(13, 10);
    const header = scrubText("POST /x" + crlf + "Authorization: Bearer ABCDEF123456");
    expect(header).toContain("[redigido]");
    expect(header).not.toContain("ABCDEF123456");
    expect(scrubText('{"access_token":"AT-TEXTO-1","expires_in":3600}')).toBe('{"access_token":"[redigido]","expires_in":3600}');
    expect(scrubText("password=SENHA-TEXTO-4&pagina=2&client_secret=CS-TEXTO-5")).toBe("password=[redigido]&pagina=2&client_secret=[redigido]");
    expect(scrubText("Basic dXN1YXJpbzpzZW5oYQ==")).not.toContain("dXN1YXJpbzpzZW5oYQ==");
    expect(scrubText("pedido 123 entregue em 12 minutos")).toBe("pedido 123 entregue em 12 minutos"); // não redige texto comum
  });

  it("limites e robustez: string longa é cortada, array e chaves têm teto, referência circular e Buffer não derrubam o log, o mesmo objeto em dois ramos é logado nos dois", () => {
    const circular: Record<string, unknown> = { nome: "ciclo" };
    circular.eu = circular;
    const compartilhado = { valor: 1 };
    const out = sanitizeLogObject({
      longa: "x".repeat(LOG_MAX_STRING * 3),
      lista: Array.from({ length: 200 }, (_, i) => i),
      circular,
      binario: Buffer.from("segredo-binario"),
      a: compartilhado,
      b: compartilhado,
      quando: new Date("2026-11-17T12:00:00Z"),
      funcao: () => 1,
    }) as Record<string, any>;
    expect(out.longa.length).toBeLessThan(LOG_MAX_STRING + 40);
    expect(out.longa).toContain("[cortado]");
    expect(out.lista).toHaveLength(50);
    expect(out.circular.eu).toBe("[circular]");
    expect(out.binario).toBe("[binário]");
    expect(out.a).toEqual({ valor: 1 });
    expect(out.b).toEqual({ valor: 1 });
    expect(out.quando).toBeInstanceOf(Date);
    expect(out.funcao).toBeUndefined();
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys((sanitizeLogObject({ many }) as Record<string, any>).many).length).toBeLessThanOrEqual(101);
  });

  it("NÃO redige a mais: os logs de jobs e de requisição seguem legíveis; `req`, `res` e `err` passam intactos para os serializadores", () => {
    const req = { method: "GET", url: "/x" };
    const err = new Error("boom");
    const out = sanitizeLogObject({ job: "tech.cleanup", durationMs: 12, lagMs: 3, processed: 40, error: "mensagem do job", req, res: { statusCode: 200 }, err }) as Record<string, unknown>;
    expect(out).toMatchObject({ job: "tech.cleanup", durationMs: 12, lagMs: 3, processed: 40, error: "mensagem do job" });
    expect(out.req).toBe(req); // mesma referência: o serializador `req` decide o que loga
    expect(out.err).toBe(err); // o Error de `err` chega ao serializador `err` (que aplica o `safeError`)
  });
});

describe("ST-74: texto digitado pelo cliente tem teto no log", () => {
  it("404 com 1º segmento de 8 KB e Host de 8 KB: a linha leva no máximo 32 caracteres do segmento e 255 do Host; CONTROLE POSITIVO: a linha existe", async () => {
    const { app, lines, parsed } = capture();
    await app.ready();
    const big = "a".repeat(8000);
    await app.inject({ method: "GET", url: `/${big}/resto` });
    await app.inject({ method: "GET", url: "/nao-existe", headers: { host: `${"h".repeat(8000)}.example.com` } });
    await app.close();
    const all = lines.join("\n");
    expect(all).not.toContain("a".repeat(LOG_CLIENT_TEXT_MAX + 1));
    expect(all).not.toContain("h".repeat(LOG_HOSTNAME_MAX + 1));
    expect(all.length).toBeLessThan(5000);
    const incoming = parsed().filter((l) => l.msg === "incoming request");
    expect(incoming).toHaveLength(2);
    expect(incoming[0].req.url).toBe(`/${"a".repeat(LOG_CLIENT_TEXT_MAX)}…/[redigido]`);
    expect(incoming[1].req.hostname).toBe(`${"h".repeat(LOG_HOSTNAME_MAX)}…`);
  });
});
