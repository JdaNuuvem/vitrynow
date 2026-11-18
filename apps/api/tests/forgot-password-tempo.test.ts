import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as emailLib from "../src/lib/email";
import { FORGOT_MIN_DURATION_MS } from "../src/lib/passwordReset";
import { makeApp, registerStore, resetDb } from "./helpers";

// SEC-39 (ST-57, teste de SEGURANÇA; decisão do Atlas, 17/11): o "esqueci a senha" não revela por TEMPO se a conta existe. Era um teste de tempo ABSOLUTO dentro
// da suíte paralela (diferença entre medianas < 35 ms com 4 amostras por ramo) e um pico de ~1,3 s do ambiente o derrubou (CI na main 7d6e73c; isolado passou 8 de 8).
// Agora tem o desenho entrelaçado do SEC-38 e roda no ESTÁGIO ISOLADO de tempo do scripts/ci.ps1 (arquivo próprio, fora da suíte paralela). Nada foi afrouxado:
// o limite segue < 35 ms, o piso segue exigido e o teste segue falhando quando um ramo fica mais lento que os outros.

const SEND_DELAY_MS = 700; // o envio real ao provedor leva centenas de ms; em teste ele seria instantâneo e esconderia o oráculo (tem de ser MAIOR que o piso de 350 ms)
const ROUNDS = 15;
let ipSeq = 0;
const nextIp = () => `10.78.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`; // o limite por IP da rota (5/min) não pode atrapalhar

describe("forgot-password: MESMO tempo para conta existente, inexistente e limitada (SEC-39, ex-ST-57)", () => {
  let app: ReturnType<typeof makeApp>;
  const sent: { to: string; resetUrl: string }[] = [];

  beforeEach(async () => {
    await resetDb();
    app = makeApp();
    sent.length = 0;
    vi.spyOn(emailLib, "sendPasswordResetEmail").mockImplementation(async (input) => {
      sent.push(input);
      await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS));
    });
    await app.ready();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetDb();
  });

  const forgot = (email: string) => app.inject({ method: "POST", url: "/auth/forgot-password", remoteAddress: nextIp(), payload: { email } });
  const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)];

  it("diferença PAREADA entre as medianas < 35 ms, todos os ramos no piso, mesmo corpo, e a resposta NÃO espera o envio de 700 ms", async () => {
    // O cadastro de loja tem limite por IP (5/min) e o app guarda o contador: contas criadas em apps descartáveis (4 por app) e usadas no app do teste (mesmo banco).
    const accounts: { email: string }[] = [];
    let registrar = makeApp();
    for (let i = 0; i < ROUNDS + 1; i += 1) {
      if (i > 0 && i % 4 === 0) registrar = makeApp();
      accounts.push((await registerStore(registrar)).credentials);
    }

    // Ramos: `existing` = 1º pedido da conta (envia, grava token); `missing` = e-mail que não existe; `limited` = a conta da rodada ANTERIOR pedindo de novo dentro dos 60 s.
    // Cada conta recebe só 2 pedidos (existing na rodada r, limited na r+1), abaixo do teto de 3 por hora. A conta [0] é a "anterior" da rodada 0 (aquecimento).
    const BRANCHES = ["existing", "missing", "limited"] as const;
    type Branch = (typeof BRANCHES)[number];
    const first = await forgot(accounts[0].email); // aquecimento: também prepara a conta que a rodada 0 usa como "limitada" e esquenta o pool do banco
    expect(first.statusCode).toBe(200);
    for (let i = 0; i < 2; i += 1) await forgot(`aquecimento-${i}@exemplo.com`);

    const durations: Record<Branch, number[]> = { existing: [], missing: [], limited: [] };
    const bodies: Record<Branch, Set<string>> = { existing: new Set(), missing: new Set(), limited: new Set() };
    for (let round = 0; round < ROUNDS; round += 1) {
      const emailOf: Record<Branch, string> = { existing: accounts[round + 1].email, missing: `nao-existe-${round}@exemplo.com`, limited: accounts[round].email };
      for (let k = 0; k < BRANCHES.length; k += 1) {
        const branch = BRANCHES[(k + round) % BRANCHES.length]; // a ordem gira a cada rodada; a conta "limitada" já foi pedida na rodada anterior, então a ordem entre ramos não importa
        const t0 = performance.now();
        const res = await forgot(emailOf[branch]);
        durations[branch].push(performance.now() - t0);
        expect(res.statusCode, `${branch} rodada ${round}`).toBe(200);
        bodies[branch].add(res.body);
      }
    }

    const medians = Object.fromEntries(BRANCHES.map((b) => [b, median(durations[b])])) as Record<Branch, number>;
    const deltas = Object.fromEntries(BRANCHES.map((b) => [b, median(durations[b].map((value, round) => value - durations.missing[round]))])) as Record<Branch, number>;
    // Linhas lidas pelo estágio de tempo do scripts/ci.ps1 (INF-20b): QUAL ramo ficou lento em cada falha.
    console.log(`TEMPO_RAMOS ${JSON.stringify(medians)}`);
    console.log(`TEMPO_DELTAS_PAREADOS ${JSON.stringify(deltas)}`);

    // o envio de verdade só acontece no ramo existente: 1 do aquecimento + 1 por rodada. Se o limitado ou o inexistente enviasse, o corpo e o tempo não bastariam.
    expect(sent).toHaveLength(ROUNDS + 1);
    for (const branch of BRANCHES) expect(bodies[branch].size, `ramo ${branch}: corpos diferentes entre pedidos`).toBe(1);
    expect([...bodies.existing][0]).toBe([...bodies.missing][0]);
    expect([...bodies.existing][0]).toBe([...bodies.limited][0]);
    // (1) DETERMINÍSTICO: nenhuma resposta de nenhum ramo volta antes do piso (o MÍNIMO, não a mediana: o ruído só soma tempo)
    for (const branch of BRANCHES) {
      const fastest = Math.min(...durations[branch]);
      expect(fastest, `ramo ${branch}: a resposta mais rápida levou ${fastest.toFixed(0)} ms, ABAIXO do piso de ${FORGOT_MIN_DURATION_MS} ms`).toBeGreaterThanOrEqual(FORGOT_MIN_DURATION_MS - 10);
    }
    // (2) mesmo tempo: a mediana da diferença PAREADA de cada ramo contra "inexistente" fica abaixo de 35 ms
    for (const branch of BRANCHES) {
      if (branch === "missing") continue;
      expect(Math.abs(deltas[branch]), `ramo ${branch}: diferença pareada mediana de ${deltas[branch].toFixed(1)} ms contra "inexistente" (limite 35)`).toBeLessThan(35);
    }
    // (3) a resposta NÃO esperou o envio (700 ms): a mediana do ramo que envia fica abaixo do tempo do envio
    expect(medians.existing, "o ramo existente esperou o envio de 700 ms").toBeLessThan(SEND_DELAY_MS);
  }, 180000);
});
