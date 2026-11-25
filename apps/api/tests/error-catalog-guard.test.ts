// D6 — guarda PURA (sem banco): todo código de erro de apps/api/src precisa de entrada em shared-types/errorMessages.
// Usa o verificador de tipos: resolve literal, ternário, constante e união. O que for só `string` aparece como "não resolvido".
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { errorMessages } from "../../../packages/shared-types/src/errorMessages";

const API = path.resolve(__dirname, "..");
const SRC = path.join(API, "src").replace(/\\/g, "/") + "/";
const UPPER = /^[A-Z][A-Z0-9_]+$/;
// posição do argumento `código` em cada construtor de erro
const CTOR_ARG: Record<string, number> = { CodedError: 1, DomainError: 2, BadRequestError: 1 };

// helpers locais que repassam o código: as CHAMADAS deles são varridas. Helper novo aparece como "não resolvido" no repasse.
const HELPERS = new Set(["fail", "invalid", "err", "bad", "deny"]);
// `code` que NÃO é código de erro (número do pedido, cupom, plano, OAuth, MFA, slug) ou repasse de um erro já varrido.
const NOT_AN_ERROR_CODE = new Set(
  [
    "jobs/errorTag.ts|code", "lib/logging.ts|code",
    "lib/mfa.ts|code", "routes/mfa.ts|code", "routes/platform.ts|code",
    "lib/printable.ts|order.code", "lib/storeCode.ts|code", "routes/auth.ts|code", "routes/platform.ts|store.code",
    "lib/subscription.ts|input.planCode", "routes/subscription.ts|parsed.data.planCode",
    "modules/coupons/coupons.repository.ts|code", "modules/coupons/coupons.service.ts|coupon.code", "modules/coupons/coupons.service.ts|c.code",
    "routes/manualOrders.ts|input.couponCode.trim().toUpperCase()", "routes/storefront.ts|input.couponCode.trim().toUpperCase()",
    "modules/orders/orders.create.ts|code", "modules/orders/orders.history.ts|o.code", "modules/orders/orders.history.ts|digits",
    "modules/orders/orders.service.ts|o.code", "modules/orders/orders.view.ts|order.code", "modules/payments/payments.module.ts|o.code",
    "modules/privacy/privacy.service.ts|m.code", "routes/manualOrders.ts|order.code", "routes/manualOrders.ts|existing.code",
    "routes/storefront.ts|order.code", "routes/tables.ts|order.code",
    "modules/storePayments/oauth.ts|code", "modules/storePayments/storePayments.routes.ts|code", "modules/storePayments/storePayments.service.ts|input.code",
    // repasses: a origem é um construtor/helper/união que a varredura já lê
    "shared/errors.ts|error.code", "routes/storefront.ts|error.code", "routes/menuCampaign.ts|error.code",
    "modules/optionGroups/optionGroups.service.ts|problems[0].code", // origem: err() em optionGroups.domain
    "modules/orders/orders.service.ts|reason.code", // validado contra HUMAN_REASON_CODES
    "modules/printJobs/printJobs.service.ts|d.lastErrorCode", // coluna do banco; valores em FAILURE_CODES
  ],
);

// verdadeiro quando `e` é o próprio parâmetro `code` de um helper conhecido ou de um construtor de erro
function isForwardedParam(checker: ts.TypeChecker, symbol: ts.Symbol | undefined) {
  const declaration = symbol?.valueDeclaration;
  if (!declaration || !ts.isParameter(declaration)) return false;
  const owner = declaration.parent;
  if (ts.isConstructorDeclaration(owner)) return (owner.parent.name?.text ?? "") in CTOR_ARG;
  return ts.isArrowFunction(owner) && ts.isVariableDeclaration(owner.parent) && HELPERS.has(owner.parent.name.getText());
}

function scan() {
  const config = ts.getParsedCommandLineOfConfigFile(path.join(API, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
  const program = ts.createProgram(config.fileNames, config.options);
  const checker = program.getTypeChecker();
  const found = new Map<string, string>();
  const unresolved: string[] = [];

  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(SRC)) continue;
    const at = (n: ts.Node) => `${file.fileName.slice(SRC.length)}:${file.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const unknownAt = (node: ts.Node) => {
      const text = node.getText().replace(/\s+/g, " ");
      if (!NOT_AN_ERROR_CODE.has(`${file.fileName.slice(SRC.length)}|${text}`)) unresolved.push(`${at(node)} ${text}`);
    };
    const add = (code: string, node: ts.Node) => {
      if (UPPER.test(code) && !found.has(code)) found.set(code, at(node));
    };
    const take = (type: ts.Type, node: ts.Node) => {
      for (const t of type.isUnion() ? type.types : [type]) {
        if (t.isStringLiteral()) add(t.value, node);
        else if (t.flags & (ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) unknownAt(node);
      }
    };
    // o tipo do contexto pode alargar o literal para `string`; por isso literal e ternário são lidos direto da sintaxe
    const value = (e: ts.Expression): void => {
      if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return value(e.expression);
      if (ts.isConditionalExpression(e)) return void [value(e.whenTrue), value(e.whenFalse)];
      if (ts.isStringLiteralLike(e)) return add(e.text, e);
      if (ts.isIdentifier(e) && isForwardedParam(checker, checker.getSymbolAtLocation(e))) return;
      take(checker.getTypeAtLocation(e), e);
    };
    const visit = (node: ts.Node) => {
      // corpo de resposta e motivo: `code: X`. Chave de consulta do Prisma (`where`) não é erro.
      const isQueryKey = (n: ts.Node): boolean => !!n && !ts.isSourceFile(n) && ((ts.isPropertyAssignment(n) && n.name.getText() === "where") || isQueryKey(n.parent));
      if (ts.isPropertyAssignment(node) && node.name.getText() === "code" && !(isQueryKey(node) && node.initializer.getText() === "TRIAL_PLAN_CODE")) value(node.initializer);
      // chamadas dos helpers: o argumento na posição do parâmetro `code` (inclui `fail(400, ...TUPLA)`)
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && HELPERS.has(node.expression.text)) {
        const parameters = checker.getResolvedSignature(node)?.parameters ?? [];
        const index = parameters.findIndex((x) => x.name === "code");
        let position = 0;
        for (const arg of node.arguments) {
          if (ts.isSpreadElement(arg)) {
            const elements = checker.getTypeArguments(checker.getTypeAtLocation(arg.expression) as ts.TypeReference);
            if (index >= position && index < position + elements.length) take(elements[index - position], arg);
            position += elements.length;
          } else if (position++ === index) value(arg);
        }
      }
      if (ts.isShorthandPropertyAssignment(node) && node.name.text === "code") {
        const symbol = checker.getShorthandAssignmentValueSymbol(node);
        if (symbol && !isForwardedParam(checker, symbol)) take(checker.getTypeOfSymbolAtLocation(symbol, node), node);
      }
      if (ts.isNewExpression(node)) {
        const index = CTOR_ARG[node.expression.getText()];
        const arg = index === undefined ? undefined : node.arguments?.[index];
        if (arg) value(arg);
      }
      // `super(...)` das subclasses (ex.: PixUnavailableError)
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.SuperKeyword) {
        let cls: ts.Node = node;
        while (!ts.isClassDeclaration(cls)) cls = cls.parent;
        const base = cls.heritageClauses?.[0]?.types[0]?.expression.getText() ?? "";
        const arg = CTOR_ARG[base] === undefined ? undefined : node.arguments[CTOR_ARG[base]];
        if (arg) value(arg);
      }
      // uniões declaradas (`type XCode = "A" | "B"`) e listas (`X_CODES = [...] as const`): códigos que chegam por variável
      if (ts.isTypeAliasDeclaration(node) && /Code$/.test(node.name.text)) take(checker.getTypeAtLocation(node.name), node.name);
      if (ts.isVariableDeclaration(node) && /_CODES$/.test(node.name.getText()) && node.initializer) {
        const list = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
        if (ts.isArrayLiteralExpression(list)) list.elements.forEach(value);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { found, unresolved };
}

describe("D6 — catálogo de erros", () => {
  const { found, unresolved } = scan();

  it("a varredura enxerga as formas conhecidas de gerar código", () => {
    // literal, CodedError, super() de subclasse, DomainError, ternário, helpers e tupla espalhada
    for (const code of ["ADDRESS_REQUIRED", "CASH_REQUIRED", "PIX_UNAVAILABLE", "STORE_NOT_FOUND", "STORE_CLOSED", "WEIGHT_OUT_OF_RANGE", "FILTER_INVALID", "ORDER_VALUE_TOO_HIGH"]) expect(found.has(code), code).toBe(true);
  });

  it("todo código de apps/api/src está no catálogo", () => {
    const missing = [...found].filter(([code]) => !(code in errorMessages)).map(([code, where]) => `${code} (${where})`).sort();
    expect(missing).toEqual([]);
  });

  it("não surge `code` novo que a varredura não consiga resolver", () => {
    expect(unresolved.sort()).toEqual([]);
  });
});
