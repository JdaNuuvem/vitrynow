import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { storefrontAcceptance } from "./storefront.mjs";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const project = process.env.VITRY_QA_PROJECT ?? "vitry-handoff-qa";
const web = process.env.VITRY_QA_WEB ?? "http://127.0.0.1:3400";
const api = process.env.VITRY_QA_API ?? "http://127.0.0.1:3401";
const output = resolve(process.env.VITRY_QA_OUTPUT ?? ".qa-output");
const suffix = randomUUID().slice(0, 8);
const storeSlug = `qa-${suffix}`;
const storeName = `Cozinha VitryNow QA ${suffix}`;
const password = `Teste-Vitry-${randomUUID()}!`;

function assertIsolatedStack() {
  assert.match(project, /^vitry-[a-z0-9-]+-qa$/);
  for (const [service, origin, port] of [["web", web, 3000], ["api", api, 3001]]) {
    const url = new URL(origin);
    assert.equal(url.origin, origin);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
    assert.ok(Number(url.port) >= 3100, "Use portas independentes do painel local padrão");
    const [container] = JSON.parse(execFileSync("docker", ["inspect", `${project}-${service}-1`], { encoding: "utf8" }));
    assert.equal(container.Config.Labels["com.docker.compose.project"], project);
    assert.equal(container.Config.Labels["com.docker.compose.service"], service);
    assert.equal(container.State.Running, true);
    assert.ok(container.NetworkSettings.Ports[`${port}/tcp`]?.some(({ HostIp, HostPort }) => HostIp === "127.0.0.1" && HostPort === url.port));
  }
}

async function browserExecutable() {
  if (process.env.VITRY_QA_BROWSER) return process.env.VITRY_QA_BROWSER;
  const candidates = process.platform === "win32" ? [
    join(process.env.ProgramFiles ?? "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
  ] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { continue; }
  }
  return undefined;
}

async function checked(response, status = 200) {
  assert.equal(response.status(), status, `${response.url()} retornou ${response.status()}`);
  return response.json();
}

async function ready(page, path, heading, control = "main :is(input, select, button, a[href]), .shell-topbar .shell-account") {
  const res = await page.goto(`${web}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  assert.equal(res?.status(), 200, path);
  await page.getByRole("main").getByRole("heading", { level: 1, name: heading, exact: true }).waitFor();
  // Uma ação imediata no HTML do servidor pode preceder a hidratação do Next em desenvolvimento.
  await page.waitForFunction((selector) => Array.from(document.querySelectorAll(selector)).some((node) =>
    node.getClientRects().length > 0 && getComputedStyle(node).visibility === "visible" &&
    Object.keys(node).some((key) => key.startsWith("__reactProps$"))), control, { timeout: 60000 });
  await page.locator('main [aria-busy="true"]:visible').first().waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).pathname, path);
}

async function assertViewport(page, widths) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const actual = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(actual <= width, `${new URL(page.url()).pathname} mede ${actual}px em viewport de ${width}px`);
  }
}

async function setMatrixTheme(page, theme) {
  await page.evaluate((value) => {
    const key = "vitrynow-theme";
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
  }, theme);
  await page.locator(`html[data-theme="${theme}"]`).waitFor({ state: "attached" });
}

async function register(page) {
  await ready(page, "/cadastro", "Criar minha loja", 'input[name="slug"]');
  await page.getByLabel("Nome da loja", { exact: true }).fill(storeName);
  await page.getByLabel(/Endereço do cardápio/).fill(storeSlug);
  await page.getByRole("button", { name: "Verificar endereço", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Endereço disponível." }).waitFor();
  await page.getByLabel("E-mail", { exact: true }).fill(`${storeSlug}@example.test`);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  const registration = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/auth/register" && response.request().method() === "POST", { timeout: 60000 });
  await page.getByRole("button", { name: "Criar loja", exact: true }).click();
  const { store: registered } = await checked(await registration, 201);
  await page.waitForURL(`${web}/dashboard/primeiros-passos`, { timeout: 60000 });
  await page.getByRole("heading", { name: "Configuração da loja", exact: true }).waitFor({ timeout: 60000 });
  await page.getByRole("link", { name: "Abrir catálogo", exact: true }).waitFor();
  const { store } = await checked(await page.context().request.get(`${api}/api/store/settings`));
  assert.equal(store.id, registered.id);
  assert.equal(store.slug, storeSlug);
  assert.equal(store.name, storeName);
  await checked(await page.context().request.post(`${api}/api/store/settings`, { data: { pickupEnabled: true } }));
  await checked(await page.context().request.post(`${api}/api/store/availability`, { data: { acceptingOrders: true } }));
}

async function appearance(page, browser) {
  await ready(page, "/dashboard/conta/aparencia", "Aparência do cardápio", "#appearance-color-hex");
  await page.getByLabel("Código HEX").fill("#7d385d");
  await page.locator('input[type="file"][aria-label="Arquivo de banner principal"]').setInputFiles(
    fileURLToPath(new URL("../../apps/web/public/local-ramenku/fachada.webp", import.meta.url)),
  );
  await page.getByText("fachada.webp", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const cover = document.querySelector(".appearance-preview .loja__cover img");
    return cover?.currentSrc.startsWith("blob:") && cover.complete && cover.naturalWidth > 0 &&
      getComputedStyle(cover).getPropertyValue("--loja-accent").trim() === "#7d385d";
  });
  await page.screenshot({ path: join(output, "02-aparencia.png") });
  await page.getByRole("button", { name: "Salvar aparência" }).click();
  await page.getByText(/^Aparência salva/).waitFor({ timeout: 60000 });
  const { store } = await checked(await page.context().request.get(`${api}/api/store/settings`));
  assert.equal(store.primaryColor, "#7d385d");
  assert.match(store.coverImageUrl, /^\/media\/stores\//);
  await page.reload();
  await page.waitForFunction((url) => document.querySelector("#appearance-color-hex")?.value === "#7d385d" &&
    document.querySelector("#appearance-cover")?.value === url, store.coverImageUrl);
  await assertViewport(page, [360, 768, 1440]);
  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await ready(visitor, `/loja/${storeSlug}`, storeName);
    // A vitrine usa o menu inicial do servidor. Recarregue entre tentativas enquanto a revalidação propaga.
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await visitor.waitForFunction((url) => {
          const cover = document.querySelector(".loja__cover img");
          return cover?.complete && cover.naturalWidth > 0 && new URL(cover.currentSrc).pathname === url &&
            getComputedStyle(cover).getPropertyValue("--loja-accent").trim() === "#7d385d";
        }, store.coverImageUrl, { timeout: 5000 });
        break;
      } catch (error) {
        if (error?.name !== "TimeoutError" || attempt === 4) throw error;
        await visitor.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
      }
    }
  } finally {
    await visitor.close();
  }
}

async function cashier(page) {
  await ready(page, "/dashboard/caixa", "Caixa");
  await page.getByLabel("Saldo inicial em dinheiro").fill("1000");
  await page.getByRole("button", { name: "Abrir caixa" }).click();
  await page.getByLabel("Valor", { exact: true }).fill("900");
  await page.getByLabel("Motivo", { exact: true }).selectOption("TROCO");
  await page.getByRole("button", { name: "Registrar movimentação" }).click();
  await page.getByText("Movimentação registrada.").waitFor();
  const counted = page.getByLabel("Valor contado na gaveta");
  const closing = page.locator("form").filter({ has: counted });
  await counted.fill("1000");
  const response = page.waitForResponse((result) => new URL(result.url()).pathname === "/api/cashier/close-preview" && result.request().method() === "GET");
  await closing.getByRole("button", { name: "Conferir valores" }).click();
  const preview = await checked(await response);
  assert.equal(preview.differenceCents, -900);
  assert.equal(preview.reasonRequired, true);
  await closing.getByLabel("Motivo", { exact: true }).selectOption("ERRO_CONTAGEM");
  await closing.getByRole("button", { name: "Fechar caixa", exact: true }).click();
  await page.getByText(/Faltou R\$\s*9,00/).waitFor();
  await page.getByRole("tab", { name: "Histórico" }).click();
  const history = page.getByRole("table", { name: "Histórico de caixas" });
  await history.waitFor();
  assert.match(await history.textContent(), /9,00/);
}

async function developmentTools(page) {
  await ready(page, "/dev/design-system", "Design system VitryNow", 'select[aria-label="Tema de cores"]');
  const theme = page.getByRole("combobox", { name: "Tema de cores" }).first();
  await theme.selectOption("dark");
  await page.locator('html[data-theme="dark"]').waitFor({ state: "attached" });
  await page.reload();
  await page.locator('html[data-theme="dark"]').waitFor({ state: "attached" });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(output, "05-design-system-escuro.png") });
  await theme.selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator('html[data-theme="light"]').waitFor({ state: "attached" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator('html[data-theme="dark"]').waitFor({ state: "attached" });
  await theme.selectOption("light");
  await page.locator('html[data-theme="light"]').waitFor({ state: "attached" });
  const foundation = page.getByRole("tab", { name: "Fundação", exact: true });
  await foundation.focus();
  await page.keyboard.press("ArrowRight");
  const controls = page.getByRole("tab", { name: "Controles", exact: true });
  assert.equal(await controls.getAttribute("aria-selected"), "true");
  await page.locator('input[aria-invalid="true"]').waitFor();
  const remove = page.getByRole("button", { name: "Remover", exact: true });
  await remove.focus();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Remover item de exemplo?" });
  await confirmation.waitFor();
  await page.keyboard.press("Escape");
  await confirmation.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Remover");

  await ready(page, "/dev/campanha", "Campanha do cardápio", ".campaign-form input");
  const title = page.getByLabel("Título", { exact: true });
  const preview = page.getByRole("group", { name: "Conteúdo exibido", exact: true });
  const published = preview.getByRole("button", { name: "Publicada", exact: true });
  assert.equal(await published.isDisabled(), true);
  await title.fill("Festival de inverno QA");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await page.getByText("Rascunho salvo.").waitFor();
  assert.equal(await published.isDisabled(), true, "Salvar rascunho mantém a publicação indisponível.");
  await page.getByRole("button", { name: "Publicar na prévia" }).click();
  await page.getByText("Campanha publicada.").waitFor();
  assert.equal(await published.getAttribute("aria-pressed"), "true");
  await page.getByRole("heading", { name: "Festival de inverno QA", exact: true }).waitFor();
  await page.getByRole("button", { name: "Ver ramens", exact: true }).click();
  await page.getByText("O botão abre Ramens.", { exact: true }).waitFor();
  await page.screenshot({ path: join(output, "06-campanha-preview.png") });
  await page.getByRole("button", { name: "Retirar publicação" }).click();
  await page.getByText("Campanha retirada do cardápio.").waitFor();
  assert.equal(await published.isDisabled(), true);
  assert.equal(await title.inputValue(), "Festival de inverno QA");
  assert.equal((await page.goto(`${web}/dashboard/conta/campanha`, { waitUntil: "domcontentloaded", timeout: 90000 })).status(), 404);
}

const dashboardPaths = [
  ["/dashboard", "Visão geral"], ["/dashboard/primeiros-passos", "Primeiros passos"],
  ["/dashboard/pedidos", "Pedidos"], ["/dashboard/pedidos/novo", "Novo pedido"],
  ["/dashboard/pedidos/historico", "Histórico"], ["/dashboard/pedidos/pix", "PIX pendentes"],
  ["/dashboard/mesas", "Mesas"], ["/dashboard/caixa", "Caixa"],
  ["/dashboard/catalogo", "Catálogo"], ["/dashboard/catalogo/opcoes", "Grupos de opções"],
  ["/dashboard/conta", "Minha loja"], ["/dashboard/conta/aparencia", "Aparência do cardápio"],
  ["/dashboard/conta/horarios", "Horários e preparo"], ["/dashboard/conta/entrega", "Bairros e taxas de entrega"],
  ["/dashboard/cupons", "Cupons"], ["/dashboard/equipe", "Equipe"],
  ["/dashboard/entregadores", "Entregadores"], ["/dashboard/auditoria", "Auditoria"],
  ["/dashboard/relatorios", "Relatórios"], ["/dashboard/planos", "Plano da loja"],
  ["/dashboard/pagamentos", "Recebimento por Pix"], ["/dashboard/impressoras", "Impressoras"],
  ["/dashboard/impressoras/fila", "Fila de impressão"], ["/dashboard/privacidade", "Privacidade"],
];

assertIsolatedStack();
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: await browserExecutable(), headless: true });
const report = { scenarios: {}, dashboard: [], failures: [] };
try {
  const ownerContext = await browser.newContext({ locale: "pt-BR", viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", extraHTTPHeaders: { Origin: web } });
  const owner = await ownerContext.newPage();
  owner.setDefaultTimeout(45000);
  const runtimeErrors = [];
  owner.on("pageerror", (error) => runtimeErrors.push(error.message));
  await register(owner);
  report.scenarios.registration = true;
  console.log("Cadastro e checklist ✓");
  report.scenarios.storefront = await storefrontAcceptance({ browser, web, api, ownerContext, storeSlug });
  console.log("Retirada e mesa com grupos nativos ✓");
  await appearance(owner, browser);
  report.scenarios.appearance = true;
  console.log("Cor, upload e cardápio publicado ✓");
  await cashier(owner);
  report.scenarios.cashier = true;
  console.log("Abertura, suprimento, conferência e histórico ✓");
  await developmentTools(owner);
  report.scenarios.designAndCampaign = true;
  console.log("Design system, temas e campanha de desenvolvimento ✓");

  const widths = [360, 390, 768, 1194, 1440];
  for (const [path, heading] of dashboardPaths) {
    try {
      await ready(owner, path, heading);
      await assertViewport(owner, widths);
      await setMatrixTheme(owner, "dark");
      await assertViewport(owner, widths);
      report.dashboard.push({ path, widths, themes: ["light", "dark"] });
      console.log(`Responsivo ${path} ✓`);
    } catch (error) {
      report.failures.push({ path, headings: await owner.locator("h1").allTextContents(), error: error.message });
      console.error(`Falha em ${path}: ${error.message}`);
    }
    await setMatrixTheme(owner, "light");
  }
  await ready(owner, "/dashboard", "Visão geral");
  await owner.screenshot({ path: join(output, "01-crm-claro.png") });
  await owner.getByRole("button", { name: "Abrir menu completo do painel" }).click();
  await owner.getByRole("combobox", { name: "Tema de cores" }).first().selectOption("dark");
  await owner.locator('html[data-theme="dark"]').waitFor({ state: "attached" });
  await owner.getByRole("button", { name: "Fechar menu", exact: true }).click();
  await owner.screenshot({ path: join(output, "03-crm-escuro.png") });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.screenshot({ path: join(output, "07-crm-mobile.png"), fullPage: true });
  const customer = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "pt-BR" });
  await ready(customer, "/loja/ramenku", "Ramenku");
  await customer.evaluate(() => document.fonts.ready);
  await customer.screenshot({ path: join(output, "04-cardapio-mobile.png"), fullPage: true });
  await writeFile(join(output, "browser.json"), JSON.stringify(report, null, 2) + "\n");
  assert.deepEqual(report.failures, []);
  assert.deepEqual(runtimeErrors, []);
} finally {
  await browser.close();
}
