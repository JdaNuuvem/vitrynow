import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Prisma, prisma, type PrismaClient } from "@meucardapio/db";
import { DISH3D_MAX_PHOTOS } from "@meucardapio/shared-types";
import { logAudit } from "./audit";
import { MAX_INPUT_PIXELS, sniffImageType } from "./imagePipeline";
import { getObjectStorage, storeKeyPrefix } from "./objectStorage";
import { DISH3D_MAX_MODEL_BYTES, DISH3D_TIMEOUT_MS, dish3dCredits, Dish3dProviderError, getDish3dProvider, isGlb, type Dish3dPhoto } from "./dish3dProvider";
import { CodedError } from "../shared/errors";
import { GlbRealSizeError, rescaleGlbToRealWidth } from "./glbRealSize";

// PRATO 3D: fotos do prato -> modelo GLB (provedor externo) -> rascunho no produto -> o dono publica no cardápio.
// Custo: créditos de IA da loja (AiCreditLedger). RESERVE ao enviar; RELEASE se a geração falhar. Sem saldo = recusa (fail-closed).

const PHOTO_MAX_SIDE = 2048;

type Actor = { storeId: string; id: string };

export async function creditBalance(storeId: string, db: Prisma.TransactionClient | PrismaClient = prisma): Promise<number> {
  const row = await db.aiCreditLedger.aggregate({ where: { storeId }, _sum: { delta: true } });
  return row._sum.delta ?? 0;
}

/** Normaliza cada foto em JPEG (sem EXIF/GPS, no máximo 2048 px). O tipo sai dos bytes, nunca do nome. */
export async function preparePhotos(files: Buffer[]): Promise<Dish3dPhoto[]> {
  if (files.length < 1 || files.length > DISH3D_MAX_PHOTOS) throw new CodedError(400, "DISH3D_PHOTOS_COUNT", "Envie de 1 a 4 fotos do prato.");
  const out: Dish3dPhoto[] = [];
  for (const file of files) {
    if (!sniffImageType(file)) throw new CodedError(415, "DISH3D_PHOTO_INVALID", "Use fotos JPG, PNG ou WebP.");
    try {
      const bytes = await sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
      out.push({ bytes, mime: "image/jpeg" });
    } catch {
      throw new CodedError(415, "DISH3D_PHOTO_INVALID", "Use fotos JPG, PNG ou WebP.");
    }
  }
  return out;
}

const ledgerKey = (jobId: string, step: "reserve" | "release") => `dish3d:${jobId}:${step}`;

async function releaseCredits(tx: Prisma.TransactionClient, job: { id: string; storeId: string; credits: number }) {
  if (job.credits === 0) return;
  await tx.aiCreditLedger.upsert({
    where: { storeId_idempotencyKey: { storeId: job.storeId, idempotencyKey: ledgerKey(job.id, "release") } },
    update: {},
    create: { storeId: job.storeId, delta: job.credits, reason: "RELEASE", note: "Prato 3D: geração falhou, créditos devolvidos", jobId: job.id, idempotencyKey: ledgerKey(job.id, "release") },
  });
}

/** Começa uma geração: reserva os créditos, cria a tarefa e envia as fotos ao provedor. */
export async function startDish3d(actor: Actor, productId: string, files: Buffer[]) {
  const provider = getDish3dProvider();
  if (!provider) throw new CodedError(503, "DISH3D_UNAVAILABLE", "O prato 3D ainda não está disponível.");
  const product = await prisma.product.findFirst({ where: { id: productId, storeId: actor.storeId }, select: { id: true, name: true } });
  if (!product) throw new CodedError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
  const photos = await preparePhotos(files);
  const credits = dish3dCredits();
  const jobId = randomUUID();

  try {
    await prisma.$transaction(async (tx) => {
      // mesma trava dos lançamentos de crédito da plataforma: saldo lido vale até o commit
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ai-credit:" + actor.storeId}))`;
      const balance = await creditBalance(actor.storeId, tx);
      if (balance < credits) throw new CodedError(402, "AI_CREDITS_INSUFFICIENT", "Créditos insuficientes para gerar o prato 3D.", { balance, credits });
      await tx.dish3dJob.create({
        data: { id: jobId, storeId: actor.storeId, productId, provider: provider.name, providerRequestId: "", credits, photoCount: photos.length, createdByUserId: actor.id },
      });
      if (credits > 0) {
        await tx.aiCreditLedger.create({
          data: { storeId: actor.storeId, delta: -credits, reason: "RESERVE", note: "Prato 3D: geração", jobId, idempotencyKey: ledgerKey(jobId, "reserve") },
        });
      }
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") throw new CodedError(409, "DISH3D_ALREADY_RUNNING", "Este prato já está sendo gerado. Aguarde terminar.");
    throw error;
  }

  // chamada externa FORA da transação
  try {
    const { requestId } = await provider.submit(photos);
    await prisma.dish3dJob.update({ where: { id: jobId }, data: { providerRequestId: requestId, nextCheckAt: new Date(Date.now() + 15_000) } });
  } catch (error) {
    const code = error instanceof Dish3dProviderError ? error.code : "PROVIDER_HTTP";
    await failJob({ id: jobId, storeId: actor.storeId, credits }, code, new Date());
    throw new CodedError(502, "DISH3D_PROVIDER_ERROR", "O serviço de 3D não respondeu. Seus créditos foram devolvidos; tente de novo.");
  }

  logAudit({ storeId: actor.storeId, userId: actor.id, action: "product.dish3d_start", targetType: "Product", targetId: productId, metadata: { jobId, credits, photos: photos.length, provider: provider.name } });
  return getDish3d(actor.storeId, productId);
}

async function failJob(job: { id: string; storeId: string; credits: number }, error: string, now: Date) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.dish3dJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "FAILED", error: error.slice(0, 60), finishedAt: now } });
    if (updated.count === 1) await releaseCredits(tx, job);
  });
}

function jobView(job: { id: string; status: string; error: string | null; createdAt: Date; finishedAt: Date | null; credits: number; photoCount: number } | null) {
  if (!job) return null;
  return { id: job.id, status: job.status, error: job.error, credits: job.credits, photoCount: job.photoCount, createdAt: job.createdAt.toISOString(), finishedAt: job.finishedAt?.toISOString() ?? null };
}

export async function getDish3d(storeId: string, productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, storeId }, select: { id: true, model3dUrl: true, model3dPublished: true, model3dWidthMm: true, model3dHeightMm: true } });
  if (!product) throw new CodedError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
  const job = await prisma.dish3dJob.findFirst({ where: { storeId, productId }, orderBy: { createdAt: "desc" } });
  return {
    available: getDish3dProvider() !== null,
    model: product.model3dUrl ? { url: product.model3dUrl, published: product.model3dPublished, widthMm: product.model3dWidthMm, heightMm: product.model3dHeightMm } : null,
    job: jobView(job),
    credits: { cost: dish3dCredits(), balance: await creditBalance(storeId) },
  };
}

/** Resumo para a tela: todos os produtos da loja com o estado do 3D. */
export async function listDish3d(storeId: string) {
  const products = await prisma.product.findMany({
    where: { storeId },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true, imageUrl: true, model3dUrl: true, model3dPublished: true, model3dWidthMm: true, model3dHeightMm: true, category: { select: { name: true } } },
  });
  // última geração de cada produto (andamento ou falha)
  const latest = await prisma.dish3dJob.findMany({ where: { storeId }, distinct: ["productId"], orderBy: [{ productId: "asc" }, { createdAt: "desc" }], select: { productId: true, status: true, error: true } });
  const lastJob = new Map(latest.map((j) => [j.productId, j]));
  return {
    available: getDish3dProvider() !== null,
    credits: { cost: dish3dCredits(), balance: await creditBalance(storeId) },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category?.name ?? null,
      imageUrl: p.imageUrl,
      model3dUrl: p.model3dUrl,
      published: p.model3dPublished,
      widthMm: p.model3dWidthMm,
      heightMm: p.model3dHeightMm,
      generating: lastJob.get(p.id)?.status === "RUNNING",
      lastError: lastJob.get(p.id)?.status === "FAILED" ? lastJob.get(p.id)!.error : null,
    })),
  };
}

export async function setDish3dPublished(actor: Actor, productId: string, published: boolean) {
  const product = await prisma.product.findFirst({ where: { id: productId, storeId: actor.storeId }, select: { model3dUrl: true, model3dWidthMm: true } });
  if (!product) throw new CodedError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
  if (published && !product.model3dUrl) throw new CodedError(409, "DISH3D_NO_MODEL", "Gere o modelo 3D antes de publicar.");
  // o 3D serve para o cliente ver o prato no TAMANHO REAL na mesa: sem a medida, não vai ao cardápio
  if (published && !product.model3dWidthMm) throw new CodedError(409, "DISH3D_SIZE_REQUIRED", "Informe o tamanho real do prato antes de publicar.");
  await prisma.product.update({ where: { id: productId }, data: { model3dPublished: published } });
  logAudit({ storeId: actor.storeId, userId: actor.id, action: published ? "product.dish3d_publish" : "product.dish3d_unpublish", targetType: "Product", targetId: productId });
  return getDish3d(actor.storeId, productId);
}

export async function removeDish3d(actor: Actor, productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, storeId: actor.storeId }, select: { model3dUrl: true } });
  if (!product) throw new CodedError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
  await prisma.product.update({ where: { id: productId }, data: { model3dUrl: null, model3dPublished: false, model3dWidthMm: null, model3dHeightMm: null } });
  logAudit({ storeId: actor.storeId, userId: actor.id, action: "product.dish3d_remove", targetType: "Product", targetId: productId });
  return getDish3d(actor.storeId, productId);
}

/** Chave do .glb a partir da URL pública, só se for desta loja (defesa: nunca lê arquivo de outra loja). */
function modelKeyOf(storeId: string, url: string | null): string | null {
  const key = url?.match(/stores\/[A-Za-z0-9_-]{1,64}\/3d-[a-f0-9-]{36}\.glb$/)?.[0] ?? null;
  return key && key.startsWith(storeKeyPrefix(storeId)) ? key : null;
}

const MODEL_CACHE = "public, max-age=31536000, immutable";

/**
 * TAMANHO REAL: o dono informa a largura do prato (maior medida vista de cima). O .glb é reescrito nessa medida, em metros,
 * e salvo numa chave NOVA (o arquivo é imutável no cache). O AR mostra o prato com esse tamanho, sem o cliente poder mudar.
 */
export async function setDish3dSize(actor: Actor, productId: string, widthMm: number) {
  const product = await prisma.product.findFirst({ where: { id: productId, storeId: actor.storeId }, select: { model3dUrl: true, model3dWidthMm: true } });
  if (!product) throw new CodedError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
  const oldKey = modelKeyOf(actor.storeId, product.model3dUrl);
  if (!oldKey) throw new CodedError(409, "DISH3D_NO_MODEL", "Gere o modelo 3D antes de informar o tamanho.");
  const storage = getObjectStorage();
  let resized: ReturnType<typeof rescaleGlbToRealWidth>;
  try {
    resized = rescaleGlbToRealWidth(await storage.get(oldKey), widthMm);
  } catch (error) {
    if (error instanceof GlbRealSizeError) throw new CodedError(422, "DISH3D_MODEL_UNMEASURABLE", "Não foi possível medir este modelo. Gere o 3D de novo.");
    throw error;
  }
  const newKey = `${storeKeyPrefix(actor.storeId)}3d-${randomUUID()}.glb`;
  await storage.put(newKey, resized.glb, { contentType: "model/gltf-binary", cacheControl: MODEL_CACHE });
  await prisma.product.update({ where: { id: productId }, data: { model3dUrl: storage.publicUrl(newKey), model3dWidthMm: resized.size.widthMm, model3dHeightMm: resized.size.heightMm } });
  // o original do gerador (modelKey da tarefa) fica guardado; só apaga cópias de medidas anteriores
  const original = await prisma.dish3dJob.findFirst({ where: { storeId: actor.storeId, productId, modelKey: oldKey }, select: { id: true } });
  if (!original) await storage.delete(oldKey).catch(() => undefined);
  logAudit({ storeId: actor.storeId, userId: actor.id, action: "product.dish3d_size", targetType: "Product", targetId: productId, metadata: { fromMm: product.model3dWidthMm, toMm: resized.size.widthMm } });
  return getDish3d(actor.storeId, productId);
}

// Recuo das consultas de status: 15 s, 20 s, 30 s ... até 2 min.
const backoffMs = (attempts: number) => Math.min(120_000, 15_000 + attempts * 5_000);

/** Usado pelo job `dish3d.poll`: consulta as gerações em andamento e guarda o modelo pronto. */
export async function pollDish3dJobs(now: Date, limit: number, db: PrismaClient = prisma): Promise<number> {
  const provider = getDish3dProvider();
  if (!provider) return 0;
  // reivindica com lease (outra instância não pega o mesmo item durante 60 s)
  const claimed = await db.$queryRaw<{ id: string; storeId: string; productId: string; providerRequestId: string; credits: number; attempts: number; createdAt: Date }[]>`
    UPDATE "Dish3dJob" SET "attempts" = "attempts" + 1, "nextCheckAt" = ${new Date(now.getTime() + 60_000)}
    WHERE "id" IN (
      SELECT "id" FROM "Dish3dJob"
      WHERE "status" = 'RUNNING' AND "nextCheckAt" <= ${now} AND "providerRequestId" <> '' AND "provider" = ${provider.name}
      ORDER BY "nextCheckAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "storeId", "productId", "providerRequestId", "credits", "attempts", "createdAt"`;

  let processed = 0;
  for (const job of claimed) {
    try {
      if (now.getTime() - job.createdAt.getTime() > DISH3D_TIMEOUT_MS) {
        await failJob(job, "TIMEOUT", now);
        processed += 1;
        continue;
      }
      const result = await provider.status(job.providerRequestId);
      if (result.state === "running") {
        await db.dish3dJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { nextCheckAt: new Date(now.getTime() + backoffMs(job.attempts)) } });
        continue;
      }
      if (result.state === "failed") {
        await failJob(job, result.error, now);
        processed += 1;
        continue;
      }
      const glb = await provider.download(result.modelUrl, DISH3D_MAX_MODEL_BYTES);
      if (!isGlb(glb)) {
        await failJob(job, "MODEL_INVALID", now);
        processed += 1;
        continue;
      }
      const key = `${storeKeyPrefix(job.storeId)}3d-${job.id}.glb`;
      const storage = getObjectStorage();
      await storage.put(key, glb, { contentType: "model/gltf-binary", cacheControl: MODEL_CACHE });
      // gerou de novo um prato que já tinha medida: o modelo novo já sai no mesmo tamanho real
      const sized = await db.product.findFirst({ where: { id: job.productId, storeId: job.storeId }, select: { model3dWidthMm: true } });
      let publicKey = key;
      let size: { widthMm: number; heightMm: number } | null = null;
      if (sized?.model3dWidthMm) {
        try {
          const resized = rescaleGlbToRealWidth(glb, sized.model3dWidthMm);
          publicKey = `${storeKeyPrefix(job.storeId)}3d-${randomUUID()}.glb`;
          await storage.put(publicKey, resized.glb, { contentType: "model/gltf-binary", cacheControl: MODEL_CACHE });
          size = { widthMm: resized.size.widthMm, heightMm: resized.size.heightMm };
        } catch (error) {
          if (!(error instanceof GlbRealSizeError)) throw error; // sem geometria medível: fica sem medida (o painel pede de novo)
        }
      }
      await db.$transaction(async (tx) => {
        const done = await tx.dish3dJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { status: "SUCCEEDED", modelKey: key, modelBytes: glb.length, finishedAt: now } });
        // modelo novo entra como RASCUNHO: o dono confere antes de ir ao cardápio
        if (done.count === 1) {
          await tx.product.updateMany({
            where: { id: job.productId, storeId: job.storeId },
            data: { model3dUrl: storage.publicUrl(publicKey), model3dPublished: false, model3dWidthMm: size?.widthMm ?? null, model3dHeightMm: size?.heightMm ?? null },
          });
        }
      });
      processed += 1;
    } catch (error) {
      // erro transitório (rede, 429): tenta de novo no recuo; o prazo de 1 h encerra de vez
      await db.dish3dJob.updateMany({ where: { id: job.id, status: "RUNNING" }, data: { nextCheckAt: new Date(now.getTime() + backoffMs(job.attempts)) } });
      if (error instanceof Dish3dProviderError && error.code === "MODEL_TOO_LARGE") {
        await failJob(job, "MODEL_TOO_LARGE", now);
        processed += 1;
      }
    }
  }
  return processed;
}
