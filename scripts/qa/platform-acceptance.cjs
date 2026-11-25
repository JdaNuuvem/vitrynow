const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { access, readFile } = require("node:fs/promises");
const { join } = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function assertLocal(endpoint) {
  const url = new URL(endpoint);
  assert(["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "O cenário aceita apenas URLs locais de QA.");
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: "commit" });
  // As páginas de login têm HTML inicial do servidor. Aguarde o React conectar o submit antes de preencher.
  if (url.endsWith("/login")) {
    await page.waitForFunction(() => {
      const form = document.querySelector("form");
      return form?.getClientRects().length && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
    });
  }
}

async function loginPlatform(page, web, account, mfaCode) {
  await goto(page, `${web}/plataforma/login`);
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Senha", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Enviar código" }).click();
  await page.getByRole("heading", { name: "Confirme sua entrada" }).waitFor();
  await page.getByLabel("Código de segurança").fill(await mfaCode(account.email, "entrada no back-office"));
  await page.getByRole("button", { name: "Confirmar entrada" }).click();
  await page.getByRole("heading", { name: "Lojas", exact: true }).waitFor();
}

async function loginPanel(page, api, web, account) {
  await goto(page, `${web}/login`);
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Senha", { exact: true }).fill(account.password);
  const received = page.waitForResponse((response) => response.url() === `${api}/auth/login` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  assert.equal((await received).status(), 200, "A conta fictícia deve acessar o CRM.");
  await page.waitForURL(/\/dashboard(?:[/?]|$)/, { waitUntil: "commit" });
}

async function checkPhoneViewport(page) {
  const [content, viewport] = await page.evaluate(async () => {
    await document.fonts.ready;
    return [document.documentElement.scrollWidth, window.innerWidth];
  });
  assert(content <= viewport + 1, `${new URL(page.url()).pathname} mede ${content}px em viewport de ${viewport}px.`);
}

async function readStore(page, store) {
  await page.getByLabel("Buscar lojas").fill(store.slug);
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await page.getByText("1 loja encontrada", { exact: true }).waitFor();
  const storeLink = page.getByRole("link", { name: store.name, exact: true });
  assert.equal(await storeLink.getAttribute("href"), `/plataforma/lojas/${store.id}`);
  await storeLink.click();
  await page.getByRole("heading", { name: store.name, exact: true }).waitFor();
  await page.getByText("Saldo atual", { exact: true }).waitFor();
}

async function storeAction(page, label, confirm, success) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: label });
  await dialog.getByLabel("Motivo").fill("Ação sobre loja descartável de QA");
  await dialog.getByRole("button", { name: confirm, exact: true }).click();
  await page.getByText(success, { exact: true }).waitFor();
}

async function supportFlow(page, api, web, fixtures) {
  await goto(page, `${web}/plataforma/avisos`);
  await page.waitForURL("**/plataforma/login", { waitUntil: "commit" });
  await loginPlatform(page, web, fixtures.support, fixtures.mfaCode);
  assert.equal((await page.request.get(`${api}/auth/me`)).status(), 401, "A sessão da plataforma deve ficar separada da sessão do CRM.");
  await page.getByLabel("Tema de cores").selectOption("dark");
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await checkPhoneViewport(page);
  await readStore(page, fixtures.store);
  assert.equal(await page.getByRole("button", { name: "Registrar lançamento" }).count(), 0);
  await checkPhoneViewport(page);
  await storeAction(page, "Estender período de teste", "Estender período", "Período de teste estendido.");
  await storeAction(page, "Suspender loja", "Suspender loja", "Loja suspensa.");
  await page.getByRole("link", { name: /Voltar para lojas/ }).click();
  await page.getByLabel("Situação na plataforma").selectOption("suspended");
  await readStore(page, fixtures.store);
  await storeAction(page, "Reativar loja", "Reativar loja", "Loja reativada.");
  await page.getByRole("link", { name: "Avisos", exact: true }).click();
  await page.getByRole("button", { name: "Novo aviso" }).click();
  const publish = page.getByRole("dialog", { name: "Publicar aviso" });
  const title = `Aviso de QA ${fixtures.store.slug}`;
  await publish.getByLabel("Título").fill(title);
  await publish.getByLabel("Mensagem").fill("Validação local do fluxo de publicação e retirada.");
  await publish.getByRole("button", { name: "Publicar aviso" }).click();
  await page.getByRole("heading", { name: title }).waitFor();
  await page.getByRole("button", { name: `Retirar aviso ${title}` }).click();
  const removal = page.getByRole("dialog", { name: "Retirar aviso" });
  await removal.getByRole("button", { name: "Retirar aviso" }).click();
  await page.getByText("Aviso retirado.", { exact: true }).waitFor();
  await page.getByRole("heading", { name: title }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page.waitForURL("**/plataforma/login", { waitUntil: "commit" });
  assert.equal((await page.request.get(`${api}/api/platform/me`)).status(), 401);
}

async function adminFlow(page, web, fixtures) {
  await loginPlatform(page, web, fixtures.admin, fixtures.mfaCode);
  await readStore(page, fixtures.store);
  await page.getByRole("button", { name: "Registrar lançamento" }).click();
  await page.getByLabel("Quantidade").fill("3");
  await page.getByLabel("Observação").fill("Lançamento de créditos do ambiente descartável");
  await page.getByRole("button", { name: "Revisar lançamento" }).click();
  await page.getByRole("button", { name: "Enviar código de segurança" }).click();
  await page.getByLabel(/Código enviado para/).fill(await fixtures.mfaCode(fixtures.admin.email, "concessão de créditos"));
  await page.getByLabel("Sua senha").fill(fixtures.admin.password);
  await page.getByRole("button", { name: "Confirmar lançamento" }).click();
  await page.getByText("Lançamento registrado no extrato.", { exact: true }).waitFor();
  await page.getByText("3 créditos", { exact: true }).waitFor();
}

async function lookupOrder(page, code) {
  await page.getByLabel("Buscar por").selectOption("orderCode");
  await page.getByLabel("Código do pedido", { exact: true }).fill(`#${code}`);
  await page.getByRole("button", { name: "Consultar pedidos" }).click();
  await page.getByRole("heading", { name: "Resultado da consulta" }).waitFor();
}

async function confirmPanelMfa(page, account, purpose, mfaCode) {
  const second = page.getByRole("dialog", { name: "Confirmação de segurança" });
  await second.getByLabel("Código de 6 dígitos").fill(await mfaCode(account.email, purpose));
  await second.getByRole("button", { name: "Confirmar", exact: true }).click();
}

async function ownerFlow(page, api, web, fixtures) {
  await loginPanel(page, api, web, fixtures.owner);
  assert.equal((await page.request.get(`${api}/api/platform/me`)).status(), 401);
  await goto(page, `${web}/dashboard/privacidade`);
  await lookupOrder(page, fixtures.openOrderCode);
  await page.getByText("Anonimização bloqueada", { exact: true }).waitFor();
  assert(await page.getByRole("button", { name: "Anonimizar dados" }).isDisabled());
  assert(await page.getByRole("button", { name: "Exportar JSON" }).isEnabled());
  await lookupOrder(page, fixtures.orderCode);
  const exportReady = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar JSON" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Exportar JSON" });
  await exportDialog.getByRole("button", { name: "Exportar JSON" }).click();
  await confirmPanelMfa(page, fixtures.owner, "exportação dos dados de um cliente", fixtures.mfaCode);
  const download = await exportReady;
  const data = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(data.orders.length, 1);
  assert(JSON.stringify(data).includes(fixtures.customerName), "O JSON deve conter o titular fictício da consulta.");
  await download.delete();
  await page.getByText("Arquivo JSON baixado.", { exact: true }).waitFor();
  await lookupOrder(page, fixtures.orderCode);
  await page.getByRole("button", { name: "Anonimizar dados" }).click();
  const privacyDialog = page.getByRole("dialog", { name: "Anonimizar dados" });
  await privacyDialog.getByLabel("Motivo").selectOption("HOLDER_REQUEST");
  await privacyDialog.getByRole("checkbox").check();
  await privacyDialog.getByRole("button", { name: "Anonimizar dados" }).click();
  await confirmPanelMfa(page, fixtures.owner, "remoção de dados pessoais de um cliente", fixtures.mfaCode);
  await page.getByText("Dados pessoais removidos de 1 pedido.", { exact: true }).waitFor();
  await lookupOrder(page, fixtures.orderCode);
  await page.getByText("Nenhum pedido com dados pessoais foi encontrado.", { exact: true }).waitFor();
  await checkPhoneViewport(page);

  await goto(page, `${web}/dashboard/impressoras`);
  await page.getByText("O dispositivo ainda precisa confirmar o modo de impressão", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Ativar fila" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar modo" }).click();
  await page.getByText("Modo de impressão atualizado", { exact: true }).waitFor();
  await checkPhoneViewport(page);
  await page.getByRole("link", { name: "Abrir fila de impressão" }).click();
  await page.getByRole("button", { name: "Imprimir teste" }).click();
  await page.getByText("Tíquete enviado para a fila.", { exact: true }).waitFor();
  await page.getByText("Teste de impressão", { exact: true }).waitFor();
  await checkPhoneViewport(page);
}

async function staffFlow(page, api, web, fixtures) {
  await loginPanel(page, api, web, fixtures.staff);
  await goto(page, `${web}/dashboard/privacidade`);
  await page.getByText("Área exclusiva do dono da loja", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Consultar pedidos" }).count(), 0);
  await goto(page, `${web}/dashboard/impressoras/fila`);
  await page.getByText("Teste de impressão", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Imprimir teste" }).count(), 0);
  await goto(page, `${web}/dashboard/impressoras`);
  await page.getByText("Essa ação é restrita ao dono da loja.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Modo de impressão" }).count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Alertas dos dispositivos" }).count(), 0);
}

async function platformAcceptance({ browser, api, web, fixtures, onPass }) {
  assertLocal(api);
  assertLocal(web);
  assert.match(fixtures.store.slug, /^qa-platform-[a-f0-9]{10}$/);
  assert.equal(fixtures.customerName, "Cliente fictício de QA");
  for (const role of ["admin", "support", "owner", "staff"]) assert.match(fixtures[role].email, /^qa-[a-z]+-[a-f0-9]{10}@example\.test$/);
  const scenarios = [
    ["SUPPORT mobile, lojas e avisos", { width: 390, height: 844 }, supportFlow],
    ["ADMIN desktop e extrato", { width: 1280, height: 880 }, (page) => adminFlow(page, web, fixtures)],
    ["OWNER mobile, privacidade e impressão", { width: 390, height: 844 }, ownerFlow],
    ["STAFF e permissões", { width: 1280, height: 880 }, staffFlow],
  ];
  for (const [name, viewport, run] of scenarios) {
    const context = await browser.newContext({ viewport, acceptDownloads: true, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(120_000);
      await run(page, api, web, fixtures);
      onPass?.(name);
    } catch (cause) {
      throw new Error(`Falha na aceitação do cenário ${name}`, { cause });
    } finally {
      await context.close();
    }
  }
  return scenarios.map(([name]) => name);
}

async function runLocal() {
  const { VITRY_QA_API, VITRY_QA_WEB, VITRY_QA_FIXTURE, VITRY_QA_API_LOG, VITRY_QA_API_CONTAINER, VITRY_QA_PLAYWRIGHT, VITRY_QA_BROWSER } = process.env;
  assert(VITRY_QA_API && VITRY_QA_WEB && VITRY_QA_FIXTURE && (VITRY_QA_API_LOG || VITRY_QA_API_CONTAINER),
    "Defina as URLs, a fixture e a origem do e-mail de teste.");
  let readMail = () => readFile(VITRY_QA_API_LOG, "utf8");
  if (VITRY_QA_API_CONTAINER) {
    assert.match(VITRY_QA_API_CONTAINER, /^[a-f0-9]{12,64}$/);
    const labels = '{{index .Config.Labels "com.docker.compose.project"}}/{{index .Config.Labels "com.docker.compose.service"}}';
    const metadata = await execFileAsync("docker", ["inspect", "--format", labels, VITRY_QA_API_CONTAINER]);
    assert.equal(metadata.stdout.trim(), "vitry-handoff-qa/api");
    assert.equal(VITRY_QA_API, "http://127.0.0.1:3401");
    assert.equal(VITRY_QA_WEB, "http://127.0.0.1:3400");
    readMail = async () => {
      const { stdout, stderr } = await execFileAsync("docker", ["logs", "--tail", "250", VITRY_QA_API_CONTAINER], { maxBuffer: 512_000 });
      return stdout + "\n" + stderr;
    };
  }
  const fixtures = JSON.parse((await readFile(VITRY_QA_FIXTURE, "utf8")).replace(/^\uFEFF/, ""));
  const secrets = new Set(["admin", "support", "owner", "staff"].map((role) => fixtures[role].password));
  fixtures.mfaCode = async (email, purpose) => {
    const marker = `(${purpose}) para ${email}: `;
    for (let tick = 0; tick < 40; tick++) {
      const log = await readMail();
      const index = log.lastIndexOf(marker);
      const code = index === -1 ? null : log.slice(index + marker.length).match(/^\d{6}/)?.[0];
      if (code) {
        secrets.add(code);
        return code;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("O código de teste esperado não apareceu no log local.");
  };
  const modulePath = VITRY_QA_PLAYWRIGHT || require.resolve("playwright-core", { paths: [join(__dirname, "../../apps/web")] });
  const { chromium } = require(modulePath);
  let executablePath = VITRY_QA_BROWSER || undefined;
  if (!executablePath && process.platform === "win32") {
    const chrome = join(process.env.ProgramFiles || "C:/Program Files", "Google/Chrome/Application/chrome.exe");
    executablePath = await access(chrome).then(() => chrome, () => undefined);
  }
  const browser = await chromium.launch({ executablePath });
  try {
    await platformAcceptance({ browser, web: VITRY_QA_WEB, api: VITRY_QA_API, fixtures, onPass: (name) => console.log(`OK ${name}`) });
  } catch (error) {
    let message = [error.message, error.cause?.message].filter(Boolean).join("\n");
    for (const secret of secrets) message = message.replaceAll(secret, "[oculto]");
    throw new Error(message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) void runLocal().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { platformAcceptance };
