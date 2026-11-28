import { randomUUID } from "node:crypto";

// PRATO 3D: contrato do provedor de "fotos -> modelo 3D". O resto do sistema só conhece esta interface;
// trocar de provedor (Rodin, TRELLIS, Tripo, Meshy) é trocar a implementação, sem mexer em rota nem tela.
// Configuração: DISH3D_PROVIDER=fake|fal (sem valor = recurso indisponível, fail-closed) e FAL_KEY para o fal.

export type Dish3dPhoto = { bytes: Buffer; mime: "image/jpeg" | "image/png" | "image/webp" };

export type Dish3dStatusResult =
  | { state: "running" }
  | { state: "done"; modelUrl: string }
  | { state: "failed"; error: string };

export interface Dish3dProvider {
  readonly name: string;
  submit(photos: Dish3dPhoto[]): Promise<{ requestId: string }>;
  status(requestId: string): Promise<Dish3dStatusResult>;
  /** Baixa o GLB do resultado (limite de tamanho aplicado pelo chamador). */
  download(url: string, maxBytes: number): Promise<Buffer>;
}

export class Dish3dProviderError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
  }
}

// GLB mínimo válido (cabeçalho glTF binário + chunk JSON) para o Fake: o visualizador abre um modelo vazio.
export function minimalGlb(): Buffer {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0", generator: "vitry-fake" }, scenes: [{ nodes: [] }], scene: 0 }));
  const pad = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.write("JSON", 4, "ascii");
  return Buffer.concat([header, chunkHeader, jsonChunk]);
}

/**
 * Caixa de teste (o fake devolve isto): uma malha de verdade, numa escala ARBITRÁRIA como a do Rodin (2 x 0,8 x 1,6 unidades),
 * para o fluxo de tamanho real ter o que medir. Só posições + índices (sem textura).
 */
export function fakeBoxGlb(): Buffer {
  const [x, y, z] = [1, 0.8, 0.8];
  const v = [[-x, 0, -z], [x, 0, -z], [x, y, -z], [-x, y, -z], [-x, 0, z], [x, 0, z], [x, y, z], [-x, y, z]];
  const positions = Buffer.alloc(v.length * 12);
  v.forEach((p, i) => p.forEach((c, k) => positions.writeFloatLE(c, i * 12 + k * 4)));
  const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  const indices = Buffer.alloc(faces.length * 2);
  faces.forEach((f, i) => indices.writeUInt16LE(f, i * 2));
  const bin = Buffer.concat([positions, indices, Buffer.alloc((4 - ((positions.length + indices.length) % 4)) % 4)]);
  const json = Buffer.from(JSON.stringify({
    asset: { version: "2.0", generator: "vitry-fake" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 }, { buffer: 0, byteOffset: positions.length, byteLength: indices.length, target: 34963 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: v.length, type: "VEC3", min: [-x, 0, -z], max: [x, y, z] },
      { bufferView: 1, componentType: 5123, count: faces.length, type: "SCALAR" },
    ],
  }));
  const jsonChunk = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.write("JSON", 4, "ascii");
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.write("BIN\0", 4, "ascii");
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin]);
}

export function isGlb(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString("ascii", 0, 4) === "glTF" && buf.readUInt32LE(4) === 2;
}

/** Fake: conclui na primeira consulta (ou falha, se a requisição foi marcada). Sem rede, sem custo. */
export class FakeDish3dProvider implements Dish3dProvider {
  readonly name = "fake";
  readonly submitted: Dish3dPhoto[][] = [];
  failNext = false;
  private failed = new Set<string>();

  async submit(photos: Dish3dPhoto[]) {
    this.submitted.push(photos);
    const requestId = `fake-${randomUUID()}`;
    if (this.failNext) {
      this.failed.add(requestId);
      this.failNext = false;
    }
    return { requestId };
  }

  async status(requestId: string): Promise<Dish3dStatusResult> {
    if (this.failed.has(requestId)) return { state: "failed", error: "PROVIDER_FAILED" };
    return { state: "done", modelUrl: `fake://${requestId}.glb` };
  }

  async download(_url: string, _maxBytes: number) {
    return fakeBoxGlb();
  }
}

// Qualidade do Rodin por configuração: DISH3D_QUALITY (padrão high) e DISH3D_HIGHPACK=true (4K, custa 3x).
export const RODIN_QUALITIES = ["high", "medium", "low", "extra-low"] as const;
export type RodinQuality = (typeof RODIN_QUALITIES)[number];
export function rodinOptions(env: NodeJS.ProcessEnv = process.env): { quality: RodinQuality; highPack: boolean } {
  const q = env.DISH3D_QUALITY as RodinQuality | undefined;
  return { quality: q && RODIN_QUALITIES.includes(q) ? q : "high", highPack: env.DISH3D_HIGHPACK === "true" };
}

const FAL_QUEUE = "https://queue.fal.run";
const FAL_MODEL = "fal-ai/hyper3d/rodin";
const FAL_APP = "fal-ai/hyper3d"; // as URLs de status/resultado usam só dono/app
const TIMEOUT_MS = 30_000;

/** Rodin (Hyper3D) pela fila HTTP do fal.ai. Várias fotos do MESMO prato: condition_mode "concat". */
export class FalRodinProvider implements Dish3dProvider {
  readonly name = "fal-rodin";
  constructor(
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly options: { quality: RodinQuality; highPack: boolean } = rodinOptions(),
  ) {}

  private async call(url: string, init: RequestInit = {}) {
    const res = await this.fetchImpl(url, {
      ...init,
      headers: { Authorization: `Key ${this.key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      // a fal.ai devolve 403 "User is locked. Reason: Exhausted balance" quando a conta fica sem saldo: não é chave errada
      const detail = await res.text().catch(() => "");
      throw new Dish3dProviderError(/balance/i.test(detail) ? "PROVIDER_NO_BALANCE" : "PROVIDER_AUTH");
    }
    if (res.status === 402) throw new Dish3dProviderError("PROVIDER_NO_BALANCE");
    if (res.status === 429) throw new Dish3dProviderError("PROVIDER_BUSY");
    if (!res.ok) throw new Dish3dProviderError("PROVIDER_HTTP", `fal ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  async submit(photos: Dish3dPhoto[]) {
    const body = {
      input_image_urls: photos.map((p) => `data:${p.mime};base64,${p.bytes.toString("base64")}`),
      condition_mode: "concat",
      geometry_file_format: "glb",
      material: "PBR",
      quality: this.options.quality, // high/medium/low/extra-low: mesmo preço (US$ 0,40)
      tier: "Regular",
      ...(this.options.highPack ? { addons: "HighPack" } : {}), // texturas 4K + malha densa: 3x o preço (US$ 1,20)
    };
    const data = await this.call(`${FAL_QUEUE}/${FAL_MODEL}`, {
      method: "POST",
      body: JSON.stringify(body),
      // o arquivo gerado fica 7 dias no CDN do fal; nós copiamos para o nosso armazenamento antes disso
      headers: { "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 7 * 24 * 3600 }) },
    });
    const requestId = data.request_id;
    if (typeof requestId !== "string" || !/^[\w-]{1,100}$/.test(requestId)) throw new Dish3dProviderError("PROVIDER_BAD_RESPONSE");
    return { requestId };
  }

  async status(requestId: string): Promise<Dish3dStatusResult> {
    const s = await this.call(`${FAL_QUEUE}/${FAL_APP}/requests/${encodeURIComponent(requestId)}/status`);
    if (s.status === "IN_QUEUE" || s.status === "IN_PROGRESS") return { state: "running" };
    if (s.status !== "COMPLETED") return { state: "failed", error: "PROVIDER_BAD_RESPONSE" };
    if (s.error) return { state: "failed", error: "PROVIDER_FAILED" };
    const result = await this.call(`${FAL_QUEUE}/${FAL_APP}/requests/${encodeURIComponent(requestId)}`);
    const url = (result.model_mesh as { url?: unknown } | undefined)?.url;
    if (typeof url !== "string" || !url.startsWith("https://")) return { state: "failed", error: "PROVIDER_BAD_RESPONSE" };
    return { state: "done", modelUrl: url };
  }

  async download(url: string, maxBytes: number) {
    const host = new URL(url).hostname;
    // só baixa do CDN do fal (evita SSRF caso a resposta venha adulterada)
    if (!/(^|\.)fal\.media$/.test(host) && !/(^|\.)fal\.run$/.test(host)) throw new Dish3dProviderError("PROVIDER_BAD_RESPONSE");
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Dish3dProviderError("PROVIDER_HTTP", `download ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) throw new Dish3dProviderError("MODEL_TOO_LARGE");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Dish3dProviderError("MODEL_TOO_LARGE");
    return buf;
  }
}

let override: Dish3dProvider | null | undefined;

/** Provedor configurado, ou null quando o recurso está desligado neste ambiente. */
export function getDish3dProvider(env: NodeJS.ProcessEnv = process.env): Dish3dProvider | null {
  if (override !== undefined) return override;
  const kind = env.DISH3D_PROVIDER;
  if (kind === "fake") return (override = new FakeDish3dProvider());
  if (kind === "fal") {
    if (!env.FAL_KEY) return null;
    return (override = new FalRodinProvider(env.FAL_KEY));
  }
  return null;
}

export function setDish3dProvider(provider: Dish3dProvider | null | undefined): void {
  override = provider;
}

/** Créditos por geração (1 crédito = R$ 0,01 vendido pela plataforma; Rodin custa US$ 0,40). */
export function dish3dCredits(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.DISH3D_CREDITS ?? 300);
  return Number.isInteger(n) && n >= 0 && n <= 100_000 ? n : 300;
}

export const DISH3D_MAX_MODEL_BYTES = 40 * 1024 * 1024;
export const DISH3D_TIMEOUT_MS = 60 * 60 * 1000; // desiste depois de 1 h
