import assert from "node:assert/strict";

async function json(response, status) {
  const body = await response.text();
  assert.equal(response.status(), status, `${response.url()} respondeu ${response.status()}\n${body}`);
  return JSON.parse(body);
}

function orderResponse(page, pathname) {
  return page.waitForResponse((response) =>
    new URL(response.url()).pathname === pathname && response.request().method() === "POST");
}

async function addPizza(page) {
  await page.getByRole("button", { name: "Pizza de teste QA", exact: true }).click();
  const add = page.getByRole("button", { name: /^Adicionar · R\$/ });
  await add.waitFor();
  assert.ok(await add.isDisabled(), "Escolher um tamanho é obrigatório");
  await page.getByRole("radio", { name: /^Grande ·/ }).check();
  const addFilling = page.getByRole("button", { name: "Adicionar uma unidade de Requeijão" });
  await addFilling.click();
  await addFilling.click();
  assert.ok(await addFilling.isDisabled(), "O limite de recheio é aplicado no formulário");
  assert.match(await add.textContent(), /R\$\s*76,00/);
  await page.getByLabel("Alguma observação?").fill("Bem assada");
  await add.click();
  await page.getByRole("button", { name: /Ver carrinho/ }).click();
  const cart = page.getByRole("dialog", { name: "Seu carrinho" });
  await cart.waitFor();
  assert.match(await cart.textContent(), /Tamanho QA: Grande/);
  assert.match(await cart.textContent(), /Borda QA: 2× Requeijão/);
  await cart.getByRole("button", { name: "Continuar" }).click();
}

async function assertViewport(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Cardápio sem rolagem lateral no celular");
}

export async function storefrontAcceptance({ browser, web, api, ownerContext, storeSlug }) {
  const owner = ownerContext.request;
  const post = async (path, data, status = 201) => json(await owner.post(`${api}${path}`, { data }), status);
  const { category } = await post("/api/catalog/categories", { name: "Pizzas QA" });
  const { product } = await post("/api/catalog/products", { name: "Pizza de teste QA", categoryId: category.id, priceCents: 4800 });
  const { group: tamanho } = await post("/api/catalog/option-groups", {
    name: "Tamanho QA", priceMode: "BASE", minSelect: 1, maxSelect: 1, maxPerOption: 1,
    options: [{ name: "Normal", priceCents: 4800 }, { name: "Grande", priceCents: 6000 }],
  });
  const { group: borda } = await post("/api/catalog/option-groups", {
    name: "Borda QA", priceMode: "SUM", minSelect: 0, maxSelect: 2, maxPerOption: 2,
    options: [{ name: "Requeijão", priceCents: 800 }],
  });
  await post(`/api/catalog/products/${product.id}/option-groups`, { groupIds: [tamanho.id, borda.id] }, 200);
  const { table } = await post("/api/tables", { label: "QA 01" });
  await post("/api/store/qr-settings", { qrOrderingEnabled: true, qrOrdersNeedApproval: true }, 200);

  const menuPath = `/stores/${encodeURIComponent(storeSlug)}`;
  const publicPath = `/loja/${encodeURIComponent(storeSlug)}`;
  const expectedSelections = [
    { optionId: tamanho.options[1].id, quantity: 1 },
    { optionId: borda.options[0].id, quantity: 2 },
  ];

  async function assertOrder(response, type) {
    const { items } = response.request().postDataJSON();
    assert.equal(items[0].expectedUnitPriceCents, 7600);
    assert.deepEqual(items[0].optionSelections, expectedSelections);
    const placed = await json(response, 201);
    const { order } = await json(await owner.get(`${api}/api/orders/${placed.orderId}`), 200);
    assert.equal(order.type, type);
    assert.equal(order.totalCents, 7600);
    assert.equal(order.items[0].notes, "Bem assada");
    assert.equal(order.items[0].options.length, 2);
    const selected = Object.fromEntries(order.items[0].options.map(({ name, priceCents, quantity }) => [name, { priceCents, quantity }]));
    assert.deepEqual(selected, { Grande: { priceCents: 6000, quantity: 1 }, Requeijão: { priceCents: 800, quantity: 2 } });
    return placed;
  }

  const customer = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-BR", colorScheme: "light", reducedMotion: "reduce" });
  try {
    const page = await customer.newPage();
    await page.goto(`${web}${publicPath}`, { waitUntil: "networkidle", timeout: 90_000 });
    await addPizza(page);
    const checkout = page.getByRole("dialog", { name: "Finalizar pedido" });
    const pickup = checkout.getByRole("radio", { name: "Retirar no local", exact: true });
    if (await pickup.count()) await pickup.check();
    await checkout.getByRole("textbox", { name: /^Nome/ }).fill("Cliente QA");
    await checkout.getByRole("textbox", { name: /^Telefone/ }).fill("11999990000");
    await checkout.getByRole("radio", { name: "Dinheiro", exact: true }).check();
    const placed = orderResponse(page, `${menuPath}/orders`);
    await checkout.getByRole("button", { name: /^Finalizar pedido ·/ }).click();
    const receipt = await assertOrder(await placed, "BALCAO");
    assert.equal(receipt.totalCents, 7600);
    await page.getByRole("heading", { name: /Pedido enviado/ }).waitFor();
    await assertViewport(page);

    await page.goto(`${web}${table.qrPath}`, { waitUntil: "networkidle", timeout: 90_000 });
    await page.getByRole("combobox", { name: "Tema de cores" }).selectOption("dark");
    await page.locator('html[data-theme="dark"]').waitFor({ state: "attached" });
    await addPizza(page);
    const qr = page.getByRole("dialog", { name: "Revisar pedido da mesa" });
    await qr.getByLabel("Seu nome (opcional)").fill("Cliente QR QA");
    const sent = orderResponse(page, `${menuPath}/tables/${table.qrToken}/orders`);
    await qr.getByRole("button", { name: /Enviar pedido ·/ }).click();
    const tableOrder = await assertOrder(await sent, "MESA");
    const history = page.getByRole("dialog", { name: "Meus pedidos" });
    await history.getByText(`Pedido ${tableOrder.code}`, { exact: true }).waitFor();
    assert.match(await history.textContent(), /Borda QA: 2× Requeijão/);
    await history.getByRole("button", { name: "Fechar", exact: true }).click();
    await assertViewport(page);
    return { pickup: receipt.code, table: tableOrder.code, totalCents: receipt.totalCents };
  } finally {
    await customer.close();
  }
}
