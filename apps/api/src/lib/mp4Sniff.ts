// Confere o CONTEÚDO do arquivo (nunca extensão nem Content-Type) lendo só as caixas (boxes) do contêiner MP4/MOV na memória:
// tipo (ftyp), duração (mvhd) e tamanho do quadro (tkhd). Não decodifica nada; o ffprobe do worker confere de novo (ADR-0021).
// O API não precisa de binário de vídeo. Recusa o que não for MP4/MOV com duração legível.

export type Mp4Info = { durationMs: number; width: number; height: number };
export type SniffResult = { ok: true; info: Mp4Info } | { ok: false; reason: "NOT_MP4" | "NO_DURATION" };

const BRANDS_OK = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "qt  ", "M4V ", "M4A ", "mmp4", "dash", "3gp4", "3gp5"]);
const MAX_DEPTH = 6;

type Box = { type: string; start: number; payload: number; end: number };

function* boxes(buf: Buffer, from: number, to: number): Generator<Box> {
  let pos = from;
  while (pos + 8 <= to) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > to) return;
      const big = buf.readBigUInt64BE(pos + 8);
      if (big > BigInt(to - pos)) return;
      size = Number(big);
      header = 16;
    } else if (size === 0) {
      size = to - pos; // vai até o fim do arquivo
    }
    if (size < header || pos + size > to) return; // caixa truncada ou inválida
    yield { type, start: pos, payload: pos + header, end: pos + size };
    pos += size;
  }
}

function parseMvhd(buf: Buffer, box: Box): number | null {
  const version = buf[box.payload];
  if (version === 0) {
    if (box.payload + 20 > box.end) return null;
    const timescale = buf.readUInt32BE(box.payload + 12);
    const duration = buf.readUInt32BE(box.payload + 16);
    return timescale > 0 ? Math.round((duration / timescale) * 1000) : null;
  }
  if (version === 1) {
    if (box.payload + 32 > box.end) return null;
    const timescale = buf.readUInt32BE(box.payload + 20);
    const duration = Number(buf.readBigUInt64BE(box.payload + 24));
    return timescale > 0 ? Math.round((duration / timescale) * 1000) : null;
  }
  return null;
}

// tkhd: largura e altura em ponto fixo 16.16 nos 8 últimos bytes; a matriz diz se o vídeo está girado (iPhone grava vertical como 1920x1080 + giro de 90°).
function parseTkhd(buf: Buffer, box: Box): { width: number; height: number } | null {
  const version = buf[box.payload];
  const matrixAt = box.payload + (version === 1 ? 48 : 40);
  const sizeAt = matrixAt + 36;
  if (sizeAt + 8 > box.end) return null;
  let width = buf.readUInt32BE(sizeAt) / 65536;
  let height = buf.readUInt32BE(sizeAt + 4) / 65536;
  const a = buf.readInt32BE(matrixAt);
  const b = buf.readInt32BE(matrixAt + 4);
  if (a === 0 && b !== 0) [width, height] = [height, width]; // giro de 90° ou 270°
  return { width: Math.round(width), height: Math.round(height) };
}

export function sniffMp4(buf: Buffer): SniffResult {
  let ftypOk = false;
  let durationMs: number | null = null;
  let size = null as { width: number; height: number } | null;
  const walk = (from: number, to: number, depth: number) => {
    for (const box of boxes(buf, from, to)) {
      if (box.type === "ftyp" && depth === 0) {
        const major = buf.toString("latin1", box.payload, box.payload + 4);
        ftypOk = BRANDS_OK.has(major);
        for (let at = box.payload + 8; at + 4 <= box.end && !ftypOk; at += 4) ftypOk = BRANDS_OK.has(buf.toString("latin1", at, at + 4));
      } else if (box.type === "moov" || box.type === "trak") {
        if (depth < MAX_DEPTH) walk(box.payload, box.end, depth + 1);
      } else if (box.type === "mvhd" && durationMs === null) {
        durationMs = parseMvhd(buf, box);
      } else if (box.type === "tkhd") {
        const dims = parseTkhd(buf, box);
        if (dims && dims.width > 0 && dims.height > 0 && (!size || dims.width * dims.height > size.width * size.height)) size = dims; // a trilha de vídeo é a de maior área
      }
    }
  };
  if (buf.length < 16) return { ok: false, reason: "NOT_MP4" };
  const first = [...boxes(buf, 0, buf.length)][0];
  if (!first || first.type !== "ftyp") return { ok: false, reason: "NOT_MP4" };
  walk(0, buf.length, 0);
  if (!ftypOk) return { ok: false, reason: "NOT_MP4" };
  if (durationMs === null || durationMs <= 0 || !size) return { ok: false, reason: "NO_DURATION" };
  return { ok: true, info: { durationMs, width: size.width, height: size.height } };
}
