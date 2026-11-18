import sharp, { type Metadata } from "sharp";

// API-18 / ADR-0010 §1.3: pipeline de imagem do servidor. Nunca confia no nome nem no Content-Type:
// o tipo vem dos magic bytes; só JPEG, PNG e WebP estáticos. Remove EXIF (sharp não copia metadados sem withMetadata),
// aplica a orientação, redimensiona para larguras fixas (sem ampliar) e converte para WebP. O original não é guardado.

export type ImageKind = "PRODUCT" | "LOGO" | "COVER";

export const WIDTHS: Record<ImageKind, number[]> = {
  PRODUCT: [320, 640, 1280],
  LOGO: [128, 256],
  COVER: [640, 1280, 1920],
};

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 24_000_000; // proteção contra image bomb
const WEBP_QUALITY = 80;

export class ImageRejectedError extends Error {
  constructor(
    readonly code: "UNSUPPORTED_TYPE" | "TOO_MANY_PIXELS" | "ANIMATED_NOT_ALLOWED" | "CORRUPT_IMAGE",
    message: string,
  ) {
    super(message);
    this.name = "ImageRejectedError";
  }
}

/** Tipo real pelo conteúdo (magic bytes). */
export function sniffImageType(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

export type ProcessedVariant = { width: number; body: Buffer };

export async function processImage(input: Buffer, kind: ImageKind): Promise<ProcessedVariant[]> {
  const type = sniffImageType(input);
  if (!type) throw new ImageRejectedError("UNSUPPORTED_TYPE", "Formato não suportado. Envie JPEG, PNG ou WebP.");

  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (e) {
    if (/pixel limit/i.test(String((e as Error).message))) throw new ImageRejectedError("TOO_MANY_PIXELS", "Imagem grande demais em pixels.");
    throw new ImageRejectedError("CORRUPT_IMAGE", "Imagem inválida ou corrompida.");
  }
  if (meta.format !== type) throw new ImageRejectedError("UNSUPPORTED_TYPE", "O conteúdo não corresponde a um formato suportado.");
  if ((meta.pages ?? 1) > 1) throw new ImageRejectedError("ANIMATED_NOT_ALLOWED", "Imagens animadas não são aceitas.");
  if ((meta.width ?? 0) * (meta.height ?? 0) > MAX_INPUT_PIXELS) throw new ImageRejectedError("TOO_MANY_PIXELS", "Imagem grande demais em pixels.");

  try {
    const out: ProcessedVariant[] = [];
    for (const width of WIDTHS[kind]) {
      const body = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate() // aplica a orientação EXIF antes de descartar os metadados
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer(); // sem withMetadata(): EXIF/GPS/ICC saem
      out.push({ width, body });
    }
    return out;
  } catch {
    throw new ImageRejectedError("CORRUPT_IMAGE", "Imagem inválida ou corrompida.");
  }
}
