import { randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// API-18 / ADR-0010: interface de armazenamento de objetos. O domínio só conhece isto; o provedor
// (MinIO no dev, Cloudflare R2/Backblaze no futuro, ainda NÃO contratado) fica atrás de S3ObjectStorage.

export type PutOptions = { contentType: string; cacheControl: string };

export interface ObjectStorage {
  put(key: string, body: Buffer, options: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  /** Lê um objeto inteiro (o worker lê o original da quarentena). Chave inexistente lança. */
  get(key: string): Promise<Buffer>;
  /** URL pública de leitura de uma chave (só chaves do prefixo público). */
  publicUrl(key: string): string;
}

// Chaves aceitas: sempre sob o prefixo da loja e sem segmentos perigosos. Defesa em profundidade:
// as chaves são geradas pelo servidor (uuid), nunca derivadas de nome enviado.
// Imagens: stores/<loja>/<uuid>-<largura>.webp. Reels (ADR-0021): stores/<loja>/reels/<uuid>.mp4 e <uuid>-poster.webp (o padrão fechado do Caddy
// só serve estes). Quarentena do original: quarantine/reels/<loja>/<uuid>.upload, FORA de stores/ e nunca servida pelo proxy.
const KEY_RE = /^stores\/[A-Za-z0-9_-]{1,64}\/[a-f0-9-]{36}-\d{2,5}\.webp$/;
const REEL_KEY_RE = /^stores\/[A-Za-z0-9_-]{1,64}\/reels\/[a-f0-9-]{36}(\.mp4|-poster\.webp)$/;
const QUARANTINE_KEY_RE = /^quarantine\/reels\/[A-Za-z0-9_-]{1,64}\/[a-f0-9-]{36}\.upload$/;
export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) && !REEL_KEY_RE.test(key) && !QUARANTINE_KEY_RE.test(key)) throw new Error("chave de objeto inválida");
}

/** Chave PRIVADA do original enviado (quarentena). */
export function quarantineKey(storeId: string, uuid: string): string {
  return `quarantine/reels/${storeId}/${uuid}.upload`;
}

export function storeKeyPrefix(storeId: string): string {
  return `stores/${storeId}/`;
}

/** Fake em memória para testes: nenhum teste fala com rede ou disco. */
export class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; options: PutOptions }>();
  failNextPut = false;

  constructor(private readonly baseUrl = "http://storage.test/media") {}

  async put(key: string, body: Buffer, options: PutOptions): Promise<void> {
    assertSafeKey(key);
    if (this.failNextPut) {
      this.failNextPut = false;
      throw new Error("falha simulada do storage");
    }
    this.objects.set(key, { body, options });
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    this.objects.delete(key);
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const found = this.objects.get(key);
    if (!found) throw new Error("objeto não encontrado");
    return found.body;
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }
}

/**
 * Disco local do servidor (ADR-0017, decisão do Claudio 18/11: produção sem S3/R2). Os arquivos ficam em `rootDir/<chave>`; quem
 * serve ao público é o proxy (Caddy), numa rota só de leitura e sem listar diretório; a API NÃO serve arquivos.
 * Defesas: a chave passa por `assertSafeKey` (stores/<loja>/<uuid>-<largura>.webp: sem `..`, sem barra extra, sem nome do cliente);
 * o caminho final é conferido contra a raiz e, depois do mkdir, o `realpath` da pasta também (um symlink plantado em
 * stores/<loja> não leva a gravação para fora). Escrita atômica (temporário + rename): o proxy nunca serve arquivo pela metade.
 */
export class LocalDiskStorage implements ObjectStorage {
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly publicBaseUrl: string,
  ) {
    if (!path.isAbsolute(rootDir)) throw new Error("STORAGE_LOCAL_DIR deve ser um caminho absoluto");
    this.root = path.resolve(rootDir);
  }

  private fileOf(key: string): string {
    assertSafeKey(key);
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error("chave de objeto fora da pasta de uploads");
    return file;
  }

  /** A pasta REAL (depois de seguir symlinks) tem de continuar dentro da raiz REAL. */
  private async assertInsideRoot(dir: string): Promise<void> {
    const [realDir, realRoot] = await Promise.all([realpath(dir), realpath(this.root)]);
    if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) throw new Error("pasta de uploads aponta para fora da raiz");
  }

  async put(key: string, body: Buffer, _options: PutOptions): Promise<void> {
    const file = this.fileOf(key);
    const dir = path.dirname(file);
    await mkdir(dir, { recursive: true, mode: 0o755 });
    await this.assertInsideRoot(dir);
    const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, body, { flag: "wx", mode: 0o644 });
      await rename(tmp, file);
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.fileOf(key);
    try {
      await this.assertInsideRoot(path.dirname(file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // pasta inexistente: nada a apagar (idempotente)
      throw error;
    }
    await rm(file, { force: true }); // já não existir não é erro
  }

  async get(key: string): Promise<Buffer> {
    const file = this.fileOf(key);
    await this.assertInsideRoot(path.dirname(file));
    return readFile(file);
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `${this.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
  }
}

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
};

/** Qualquer S3-compatível (MinIO no dev; R2/B2 depois). Path-style para o MinIO. */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, options: PutOptions): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: options.contentType, CacheControl: options.cacheControl }),
    );
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!out.Body) throw new Error("objeto vazio");
    return Buffer.from(await out.Body.transformToByteArray());
  }

  publicUrl(key: string): string {
    return `${this.config.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
  }
}

// Lê a configuração do ambiente. Sem STORAGE_S3_ENDPOINT usa o Fake em memória (dev sem MinIO e testes):
// nunca há credencial real no código; o segredo vem do ambiente/arquivo (INF-09).
const isDevLikeEnv = (env: NodeJS.ProcessEnv) => env.NODE_ENV === "development" || env.NODE_ENV === "test";

/**
 * Falha ALTO no boot (não no 1º upload), como `assertPaymentsBootConfig`: fora de dev/teste (NODE_ENV ausente conta como produção)
 * exige S3 de verdade; nunca cai em silêncio no Fake em memória (as imagens sumiriam no próximo restart).
 */
export function assertStorageBootConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (isDevLikeEnv(env)) return;
  // ADR-0017: uploads em disco local do servidor; sem S3. O driver em disco é entregue à parte (API-18c).
  const driver = env.STORAGE_DRIVER || "s3";
  if (driver !== "s3" && driver !== "local") throw new Error(`STORAGE_DRIVER inválido: "${driver}" (use "local" ou "s3").`);
  if (driver === "local") {
    const missingLocal = ["STORAGE_LOCAL_DIR", "STORAGE_PUBLIC_BASE_URL"].filter((name) => !env[name]);
    if (missingLocal.length > 0) throw new Error(`Storage em disco não configurado: faltam ${missingLocal.join(", ")}.`);
    if (!/^(\/|[A-Za-z]:[\\/])/.test(env.STORAGE_LOCAL_DIR ?? "")) throw new Error("STORAGE_LOCAL_DIR deve ser um caminho absoluto.");
    if (!/^https:\/\//.test(env.STORAGE_PUBLIC_BASE_URL ?? "")) throw new Error("STORAGE_PUBLIC_BASE_URL deve ser https:// fora de dev/teste (URL pública das imagens).");
    return;
  }
  const missing = ["STORAGE_S3_ENDPOINT", "STORAGE_S3_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_BASE_URL"].filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Storage de imagens não configurado fora de dev/teste: faltam ${missing.join(", ")}. O Fake em memória só roda em dev/teste.`);
  if (!/^https:\/\//.test(env.STORAGE_PUBLIC_BASE_URL ?? "")) throw new Error("STORAGE_PUBLIC_BASE_URL deve ser https:// fora de dev/teste (URL pública das imagens).");
}

export function createObjectStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  assertStorageBootConfig(env);
  if (env.STORAGE_DRIVER === "local") {
    // Em dev/teste a guarda do boot não exige nada; aqui o driver exige o mínimo para funcionar (pasta absoluta e URL pública).
    if (!env.STORAGE_LOCAL_DIR || !path.isAbsolute(env.STORAGE_LOCAL_DIR)) throw new Error("STORAGE_DRIVER=local exige STORAGE_LOCAL_DIR (caminho absoluto).");
    if (!env.STORAGE_PUBLIC_BASE_URL) throw new Error("STORAGE_DRIVER=local exige STORAGE_PUBLIC_BASE_URL (URL pública da rota de mídia no proxy).");
    return new LocalDiskStorage(env.STORAGE_LOCAL_DIR, env.STORAGE_PUBLIC_BASE_URL);
  }
  const endpoint = env.STORAGE_S3_ENDPOINT;
  if (!endpoint) return new InMemoryObjectStorage(env.STORAGE_PUBLIC_BASE_URL);
  const need = (name: string) => {
    const v = env[name];
    if (!v) throw new Error(`${name} é obrigatório quando STORAGE_S3_ENDPOINT está definido`);
    return v;
  };
  const bucket = need("STORAGE_S3_BUCKET");
  return new S3ObjectStorage({
    endpoint,
    region: env.STORAGE_S3_REGION ?? "us-east-1",
    bucket,
    accessKeyId: need("STORAGE_S3_ACCESS_KEY_ID"),
    secretAccessKey: need("STORAGE_S3_SECRET_ACCESS_KEY"),
    publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL ?? `${endpoint.replace(/\/+$/, "")}/${bucket}`,
  });
}

let current: ObjectStorage | undefined;
export function getObjectStorage(): ObjectStorage {
  return (current ??= createObjectStorageFromEnv());
}
/** Só para testes: injeta o Fake. */
export function setObjectStorage(storage: ObjectStorage | undefined): void {
  current = storage;
}
