import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

// API-18 / ADR-0010: interface de armazenamento de objetos. O domínio só conhece isto; o provedor
// (MinIO no dev, Cloudflare R2/Backblaze no futuro, ainda NÃO contratado) fica atrás de S3ObjectStorage.

export type PutOptions = { contentType: string; cacheControl: string };

export interface ObjectStorage {
  put(key: string, body: Buffer, options: PutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  /** URL pública de leitura de uma chave (só chaves do prefixo público). */
  publicUrl(key: string): string;
}

// Chaves aceitas: sempre sob o prefixo da loja e sem segmentos perigosos. Defesa em profundidade:
// as chaves são geradas pelo servidor (uuid), nunca derivadas de nome enviado.
const KEY_RE = /^stores\/[A-Za-z0-9_-]{1,64}\/[a-f0-9-]{36}-\d{2,5}\.webp$/;
export function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error("chave de objeto inválida");
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

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
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
  const missing = ["STORAGE_S3_ENDPOINT", "STORAGE_S3_BUCKET", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY", "STORAGE_PUBLIC_BASE_URL"].filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`Storage de imagens não configurado fora de dev/teste: faltam ${missing.join(", ")}. O Fake em memória só roda em dev/teste.`);
  if (!/^https:\/\//.test(env.STORAGE_PUBLIC_BASE_URL ?? "")) throw new Error("STORAGE_PUBLIC_BASE_URL deve ser https:// fora de dev/teste (URL pública das imagens).");
}

export function createObjectStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  assertStorageBootConfig(env);
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
