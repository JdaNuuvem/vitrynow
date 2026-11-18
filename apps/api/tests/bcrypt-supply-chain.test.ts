import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// SEC-34 (supply chain do `bcrypt` nativo): a revisão (nightingale\sec34-bench\REVISAO-SUPPLY-CHAIN-bcrypt-6.0.0.md) vale para UMA versão e UM conjunto de
// binários pré-compilados. O pacote não tem atestado de procedência, então o que o código garante é: versão exata, hash do tarball no lockfile, script
// de instalação NEGADO de propósito e o SHA-256 de cada `.node` igual ao que foi revisado. Atualizar o pacote falha este teste e obriga nova revisão.

const REVIEWED_VERSION = "6.0.0";
const REVIEWED_INTEGRITY = "sha512-cU8v/EGSrnH+HnxV2z0J7/blxH8gq7Xh2JFT6Aroax7UohdmiJJlxApMxtKfuI7z68NvvVcmR78k2LbT6efhRg==";
const apiDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiDir, "..", "..");
const apiPackage = JSON.parse(readFileSync(path.join(apiDir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
const declared = apiPackage.dependencies?.bcrypt;

/** "<sha256>  prebuilds/linux-x64/bcrypt.musl.node" por linha ⇒ mapa caminho → hash. */
export function parseHashList(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (match) map.set(match[2], match[1]);
  }
  return map;
}

function binariesOf(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".node")) found.set(path.relative(dir, full).split(path.sep).join("/"), createHash("sha256").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(path.join(dir, "prebuilds"));
  return found;
}

/** Diferenças entre o revisado e o instalado: arquivo trocado, faltando ou a mais. */
export function diffBinaries(expected: Map<string, string>, actual: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, hash] of expected) {
    if (!actual.has(file)) problems.push(`falta ${file}`);
    else if (actual.get(file) !== hash) problems.push(`HASH DIFERENTE ${file}`);
  }
  for (const file of actual.keys()) if (!expected.has(file)) problems.push(`binário NOVO não revisado ${file}`);
  return problems;
}

const fixtureText = readFileSync(path.join(__dirname, "fixtures", "bcrypt-6.0.0-prebuilds.sha256"), "utf8");

describe("lista revisada dos binários do bcrypt 6.0.0 (sempre roda)", () => {
  const list = parseHashList(fixtureText);

  it("tem os 10 binários revisados (linux glibc e musl, win32, darwin) e todo hash tem 64 hex", () => {
    expect([...list.keys()].sort()).toEqual(
      [
        "prebuilds/darwin-arm64/bcrypt.node",
        "prebuilds/darwin-x64/bcrypt.node",
        "prebuilds/linux-arm/bcrypt.glibc.node",
        "prebuilds/linux-arm/bcrypt.musl.node",
        "prebuilds/linux-arm64/bcrypt.glibc.node",
        "prebuilds/linux-arm64/bcrypt.musl.node",
        "prebuilds/linux-x64/bcrypt.glibc.node",
        "prebuilds/linux-x64/bcrypt.musl.node",
        "prebuilds/win32-arm64/bcrypt.node",
        "prebuilds/win32-x64/bcrypt.node",
      ].sort(),
    );
    for (const hash of list.values()) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("o comparador pega binário trocado, ausente e a mais (controle positivo do próprio teste)", () => {
    const real = new Map(list);
    expect(diffBinaries(list, real)).toEqual([]);
    const swapped = new Map(list).set("prebuilds/linux-x64/bcrypt.musl.node", "0".repeat(64));
    expect(diffBinaries(list, swapped)).toEqual(["HASH DIFERENTE prebuilds/linux-x64/bcrypt.musl.node"]);
    const missing = new Map(list);
    missing.delete("prebuilds/win32-x64/bcrypt.node");
    expect(diffBinaries(list, missing)).toEqual(["falta prebuilds/win32-x64/bcrypt.node"]);
    const extra = new Map(list).set("prebuilds/linux-x64/bcrypt.extra.node", "a".repeat(64));
    expect(diffBinaries(list, extra)).toEqual(["binário NOVO não revisado prebuilds/linux-x64/bcrypt.extra.node"]);
  });
});

// Só vale depois que o `bcrypt` entra nas dependências da API (o PR do SEC-34); antes disso é pulado e a lista acima segue testada.
describe.skipIf(!declared)("bcrypt nativo instalado (SEC-34)", () => {
  const requireFromApi = createRequire(path.join(apiDir, "package.json"));
  const packageDir = () => path.dirname(requireFromApi.resolve("bcrypt/package.json"));

  it("versão EXATA (sem ^ nem ~) e igual à revisada, no package.json e no instalado", () => {
    expect(declared).toBe(REVIEWED_VERSION);
    expect((JSON.parse(readFileSync(path.join(packageDir(), "package.json"), "utf8")) as { version: string }).version).toBe(REVIEWED_VERSION);
  });

  it("lockfile fixa o hash do tarball revisado", () => {
    const lock = readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
    const entry = new RegExp(`^  bcrypt@${REVIEWED_VERSION.replace(/\./g, "\\.")}:\\s*\\r?\\n\\s+resolution: \\{integrity: (\\S+?)\\}`, "m").exec(lock);
    expect(entry, "entrada bcrypt@6.0.0 em pnpm-lock.yaml").not.toBeNull();
    expect(entry![1]).toBe(REVIEWED_INTEGRITY);
  });

  it("o script de instalação do bcrypt está NEGADO de propósito em pnpm-workspace.yaml (`bcrypt: false`), nunca permitido", () => {
    const workspace = readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
    const block = /allowBuilds:\s*\r?\n((?:[ \t]+.*\r?\n?)+)/.exec(workspace);
    expect(block, "bloco allowBuilds").not.toBeNull();
    const entries = [...block![1].matchAll(/^[ \t]+['"]?([^'":\s]+)['"]?\s*:\s*(\S+)/gm)].map((m) => [m[1], m[2]] as const);
    expect(entries.find(([name]) => name === "bcrypt")?.[1]).toBe("false"); // explícito: sem isso o pnpm acusa ERR_PNPM_IGNORED_BUILDS
  });

  it("os binários pré-compilados instalados são EXATAMENTE os revisados (SHA-256 de cada .node; nenhum a mais, nenhum trocado)", () => {
    const actual = binariesOf(packageDir());
    expect(actual.size).toBeGreaterThanOrEqual(10);
    expect(diffBinaries(parseHashList(fixtureText), actual)).toEqual([]);
  });

  it("não há pasta build/ (o pacote NÃO foi compilado nem o script de instalação rodou)", () => {
    expect(() => statSync(path.join(packageDir(), "build"))).toThrow();
  });
});
