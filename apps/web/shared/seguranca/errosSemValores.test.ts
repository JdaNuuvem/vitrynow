import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// REGRA (SEC-31 / ST-70, medição do Tesla em logs-web-standalone-excecao.md): o Next em produção NÃO imprime URL, query, cabeçalhos,
// cookie nem segredo, mas imprime a MENSAGEM inteira de uma exceção. Então um valor só vaza se o CÓDIGO o puser na mensagem. Logo:
//   • a mensagem de um `new Error(...)` do web é TEXTO FIXO: nada interpolado (`${...}`) e nada concatenado. Uma lista de nomes
//     "sensíveis" (params, token...) não basta: o valor chega por um prop chamado `valor` e escapa. Análise estática não segue o fluxo
//     dos dados, então a regra é a que a análise consegue garantir: sem parte dinâmica nenhuma;
//   • o web não escreve nada por conta própria (`console.*`): um log novo é uma decisão com revisão de segurança, não um acidente.

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === "\\") i++;
    i++;
  }
  return i + 1;
}

/** Anda por um template literal e devolve onde ele termina; coloca no `collect` o código de cada `${...}`. */
function skipTemplate(source: string, start: number, collect?: string[]): number {
  let i = start + 1;
  while (i < source.length && source[i] !== "`") {
    if (source[i] === "\\") {
      i += 2;
      continue;
    }
    if (source[i] === "$" && source[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      const expressionStart = j;
      while (j < source.length && depth > 0) {
        const char = source[j];
        if (char === "'" || char === '"') {
          j = skipQuoted(source, j);
          continue;
        }
        if (char === "`") {
          j = skipTemplate(source, j);
          continue;
        }
        if (char === "{") depth++;
        else if (char === "}") depth--;
        j++;
      }
      collect?.push(source.slice(expressionStart, j - 1));
      i = j;
      continue;
    }
    i++;
  }
  return i + 1;
}

/** Tira comentários mantendo as quebras de linha (os números de linha continuam certos). `//` de URL (https://) fica. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, (_all, lead: string) => lead);
}

/** Só o que é CÓDIGO dentro dos argumentos: o texto fixo de aspas e de templates sai; o que está em `${...}` e o que é identificador fica. */
function dynamicCode(args: string): string {
  let out = "";
  let i = 0;
  while (i < args.length) {
    const char = args[i];
    if (char === "'" || char === '"') {
      i = skipQuoted(args, i);
    } else if (char === "`") {
      const parts: string[] = [];
      i = skipTemplate(args, i, parts);
      out += " " + parts.join(" ") + " ";
    } else {
      out += char;
      i++;
    }
  }
  return out;
}

/** Argumentos de cada `new XxxError(...)` do código, com a linha onde começam. */
export function errorConstructions(source: string): { line: number; args: string }[] {
  const code = stripComments(source);
  const found: { line: number; args: string }[] = [];
  const pattern = /new\s+[A-Za-z]*Error\s*\(/g;
  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    const open = match.index + match[0].length - 1;
    let depth = 1;
    let i = open + 1;
    while (i < code.length && depth > 0) {
      const char = code[i];
      if (char === "'" || char === '"') {
        i = skipQuoted(code, i);
        continue;
      }
      if (char === "`") {
        i = skipTemplate(code, i);
        continue;
      }
      if (char === "(") depth++;
      else if (char === ")") depth--;
      i++;
    }
    found.push({ line: code.slice(0, match.index).split("\n").length, args: code.slice(open + 1, i - 1) });
  }
  return found;
}

/** `new Error(...)` cuja mensagem NÃO é texto fixo (tem `${...}`, concatenação, variável ou chamada). */
export function dynamicErrorMessages(source: string): string[] {
  return errorConstructions(source)
    // "+" e espaço sozinhos sobram de 'uma' + ' ' + 'frase' (texto fixo concatenado): não são parte dinâmica
    .filter(({ args }) => dynamicCode(args).replace(/[\s+]/g, "") !== "")
    .map(({ line, args }) => `linha ${line}: new Error(${args.replace(/\s+/g, " ").trim().slice(0, 100)})`);
}

export function consoleCalls(source: string): string[] {
  return stripComments(source)
    .split("\n")
    .flatMap((text, index) => (/\bconsole\s*\./.test(text) ? [`linha ${index + 1}: ${text.trim().slice(0, 100)}`] : []));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}

const ROOT = join(__dirname, "..", "..");
const scan = (check: (source: string) => string[]) => {
  const found: string[] = [];
  for (const dir of ["app", "features", "shared", "core", "lib"]) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      for (const hit of check(readFileSync(file, "utf8"))) found.push(`${relative(ROOT, file)} ${hit}`);
    }
  }
  return found;
};

describe("regra: mensagem de erro do web é texto fixo (SEC-31)", () => {
  it("nenhum `new Error(...)` do código tem parte dinâmica (o Next imprime a mensagem inteira no log do contêiner)", () => {
    const found = scan(dynamicErrorMessages);
    expect(found, `mensagem de erro com parte dinâmica:\n${found.join("\n")}`).toEqual([]);
  });

  it("o web não escreve nada por conta própria: nenhum console.* fora de teste", () => {
    const found = scan(consoleCalls);
    expect(found, `console.* no código do web:\n${found.join("\n")}`).toEqual([]);
  });
});

describe("o detector funciona (senão a varredura acima não prova nada)", () => {
  it("acha as formas que vazaram na medição: parâmetro na mensagem, em template e por concatenação", () => {
    expect(dynamicErrorMessages('throw new Error("falha ao renderizar com o valor " + params.valor);')).toHaveLength(1);
    expect(dynamicErrorMessages("throw new Error(`falhou ${params.slug}`);")).toHaveLength(1);
    expect(dynamicErrorMessages("throw new TypeError(`token ruim: ${searchParams.get('token')}`);")).toHaveLength(1);
    expect(dynamicErrorMessages("throw new Error('x ' + request.headers.get('x-order-token'));")).toHaveLength(1);
    expect(dynamicErrorMessages("throw new Error(`falha em ${url}`);")).toHaveLength(1);
  });

  it("acha o valor que chega por um nome SEM cara de segredo (o caso do componente de cliente: prop `valor`)", () => {
    expect(dynamicErrorMessages('throw new Error("falha no componente de cliente com o valor " + valor);')).toHaveLength(1);
    expect(dynamicErrorMessages("throw new Error(`erro ${x}`);")).toHaveLength(1);
  });

  it("acha o valor dentro de um template aninhado e de uma chamada", () => {
    expect(dynamicErrorMessages("throw new Error(`a ${format(`b ${params.id}`)}`);")).toHaveLength(1);
    expect(dynamicErrorMessages("throw new Error(String(headers.get('cookie')));")).toHaveLength(1);
    expect(dynamicErrorMessages("throw new Error(message);")).toHaveLength(1);
  });

  it("não acusa mensagem fixa, nem a que só CONTÉM as palavras sensíveis entre aspas", () => {
    expect(dynamicErrorMessages('throw new Error("useAuthGateway precisa estar dentro de <AuthServicesProvider>");')).toEqual([]);
    expect(dynamicErrorMessages('throw new Error("token inválido ou expirado");')).toEqual([]);
    expect(dynamicErrorMessages("throw new Error(`cardápio indisponível (cache negativo)`);")).toEqual([]);
    expect(dynamicErrorMessages("throw new Error('uma' + ' ' + 'frase');")).toEqual([]);
    expect(dynamicErrorMessages("throw new Error(\"texto com (parênteses) e ${nao interpolado}\");")).toEqual([]);
  });

  it("ignora comentário e acerta a linha", () => {
    expect(dynamicErrorMessages("// throw new Error(`x ${params.id}`);")).toEqual([]);
    expect(dynamicErrorMessages("/* new Error(`x ${params.id}`) */")).toEqual([]);
    const hit = dynamicErrorMessages("const a = 1;\n\nthrow new Error(`x ${params.id}`);");
    expect(hit[0]).toMatch(/^linha 3:/);
  });

  it("acha console.* e ignora comentário", () => {
    expect(consoleCalls("console.log(1)")).toHaveLength(1);
    expect(consoleCalls("console . warn('x')")).toHaveLength(1);
    expect(consoleCalls("// console.log(1)\nconst x = 1;")).toEqual([]);
    expect(consoleCalls('const text = "sem console aqui";')).toEqual([]);
  });
});
