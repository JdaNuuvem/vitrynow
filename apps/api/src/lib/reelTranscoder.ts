import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { REEL_LIMITS } from "./reelConfig";
import { sniffMp4 } from "./mp4Sniff";

// Conversão de vídeo (ADR-0021): ffprobe confere o CONTEÚDO; ffmpeg SEMPRE recodifica (nunca copia o fluxo do cliente).
// Este módulo roda só no worker. O isolamento forte (sem rede, usuário sem privilégio, CPU/memória) é do contêiner (Hopper, INF-35);
// aqui entram as defesas do processo: sem shell, ambiente mínimo, só o protocolo `file`, prazo, limite de saída e pasta temporária própria.

export type ReelRejectCode = "VIDEO_TOO_LONG" | "VIDEO_FORMAT_INVALID" | "VIDEO_PROCESSING_FAILED";
export class ReelRejectedError extends Error {
  constructor(
    readonly code: ReelRejectCode,
    message: string,
  ) {
    super(message);
    this.name = "ReelRejectedError";
  }
}

export type TranscodeResult = { mp4: Buffer; poster: Buffer; durationMs: number; width: number; height: number };

export interface ReelTranscoder {
  /** Valida pelo conteúdo e converte. Lança `ReelRejectedError` quando o arquivo não serve; qualquer outro erro é falha técnica (nova tentativa). */
  transcode(input: Buffer): Promise<TranscodeResult>;
}

/** Folga entre a duração declarada e a medida (arredondamento do contêiner): "30 s" gravados podem medir 30,04 s. */
export const DURATION_TOLERANCE_MS = 500;

export function tooLong(durationMs: number): boolean {
  return durationMs > REEL_LIMITS.maxDurationMs + DURATION_TOLERANCE_MS;
}

export const OUTPUT_WIDTH = 720;
export const OUTPUT_HEIGHT = 1280;

type RunResult = { code: number | null; stdout: Buffer; stderr: string };

function run(bin: string, args: string[], timeoutMs: number, maxStdout = 64 * 1024 * 1024): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "" };
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot; // Windows (dev) precisa disto para carregar DLLs
    const child = spawn(bin, args, { shell: false, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxStdout) child.kill("SIGKILL");
      else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (err.length < 4000) err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${path.basename(bin)}: tempo esgotado`));
      resolve({ code, stdout: Buffer.concat(out), stderr: err });
    });
  });
}

type Probe = { format: { format_name?: string; duration?: string }; streams: { codec_type?: string; codec_name?: string; width?: number; height?: number }[] };

const FORMAT_INVALID = "Use um vídeo MP4 ou MOV.";

export class FfmpegTranscoder implements ReelTranscoder {
  constructor(
    private readonly ffmpeg = process.env.FFMPEG_PATH || "ffmpeg",
    private readonly ffprobe = process.env.FFPROBE_PATH || "ffprobe",
    private readonly timeoutMs = Number(process.env.REELS_TRANSCODE_TIMEOUT_MS) || 180_000,
  ) {}

  async transcode(input: Buffer): Promise<TranscodeResult> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "reel-"));
    try {
      const inFile = path.join(dir, "in.bin");
      const outFile = path.join(dir, "out.mp4");
      await writeFile(inFile, input, { mode: 0o600 });

      const probe = await this.probe(inFile);
      const video = probe.streams.find((s) => s.codec_type === "video");
      const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
      const formats = (probe.format.format_name ?? "").split(",");
      if (!video || !(formats.includes("mp4") || formats.includes("mov"))) throw new ReelRejectedError("VIDEO_FORMAT_INVALID", FORMAT_INVALID);
      const durationMs = Math.round(Number(probe.format.duration) * 1000);
      if (!Number.isFinite(durationMs) || durationMs <= 0) throw new ReelRejectedError("VIDEO_FORMAT_INVALID", FORMAT_INVALID);
      if (tooLong(durationMs)) throw new ReelRejectedError("VIDEO_TOO_LONG", "O vídeo passa de 30 segundos.");

      const seconds = ((REEL_LIMITS.maxDurationMs + DURATION_TOLERANCE_MS) / 1000).toFixed(1);
      const args = [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file", "-threads", "2",
        "-t", seconds, "-i", `file:${inFile}`,
        "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0"] : []), "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
        // preenche 720x1280 e corta ao centro (horizontal vira vertical; vertical 9:16 não perde nada)
        "-vf", `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-maxrate", "2M", "-bufsize", "4M", "-pix_fmt", "yuv420p", "-profile:v", "main",
        ...(hasAudio ? ["-c:a", "aac", "-b:a", "96k", "-ac", "2"] : ["-an"]),
        "-movflags", "+faststart", "-y", outFile,
      ];
      const encoded = await run(this.ffmpeg, args, this.timeoutMs);
      if (encoded.code !== 0) throw new ReelRejectedError("VIDEO_PROCESSING_FAILED", `ffmpeg falhou: ${encoded.stderr.slice(0, 300)}`);

      const mp4 = await readFile(outFile);
      const poster = await this.poster(outFile, durationMs);
      return { mp4, poster, durationMs, width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async probe(file: string): Promise<Probe> {
    const result = await run(
      this.ffprobe,
      ["-v", "error", "-protocol_whitelist", "file", "-print_format", "json", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height", `file:${file}`],
      30_000,
      1024 * 1024,
    );
    if (result.code !== 0) throw new ReelRejectedError("VIDEO_FORMAT_INVALID", FORMAT_INVALID);
    try {
      return JSON.parse(result.stdout.toString("utf8")) as Probe;
    } catch {
      throw new ReelRejectedError("VIDEO_FORMAT_INVALID", FORMAT_INVALID);
    }
  }

  /** Capa de quadro fixo (1 s; vídeo mais curto usa o primeiro quadro). Sai como WebP pelo mesmo `sharp` das fotos. */
  private async poster(mp4: string, durationMs: number): Promise<Buffer> {
    const second = durationMs > (REEL_LIMITS.posterSecond + 0.5) * 1000 ? REEL_LIMITS.posterSecond : 0;
    const frame = await run(
      this.ffmpeg,
      ["-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file", "-ss", String(second), "-i", `file:${mp4}`, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
      60_000,
    );
    if (frame.code !== 0 || frame.stdout.length === 0) throw new ReelRejectedError("VIDEO_PROCESSING_FAILED", "não foi possível gerar a capa");
    return sharp(frame.stdout).resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: "cover" }).webp({ quality: 78 }).toBuffer();
  }
}

/** Fake dos testes (CA-REEL-11): nenhum processo, nenhuma rede. Lê só o contêiner (mesma leitura do API) e devolve bytes pequenos e fixos. */
export class FakeTranscoder implements ReelTranscoder {
  calls = 0;
  /** Próxima chamada lança este erro (falha técnica ou rejeição). */
  failNext: Error | undefined;
  delayMs = 0;
  inFlight = 0;
  maxInFlight = 0;
  constructor(private readonly output: { mp4Bytes: number; posterBytes: number } = { mp4Bytes: 4_000, posterBytes: 500 }) {}

  async transcode(input: Buffer): Promise<TranscodeResult> {
    this.calls += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      if (this.failNext) {
        const error = this.failNext;
        this.failNext = undefined;
        throw error;
      }
      const sniffed = sniffMp4(input);
      if (!sniffed.ok) throw new ReelRejectedError("VIDEO_FORMAT_INVALID", FORMAT_INVALID);
      if (tooLong(sniffed.info.durationMs)) throw new ReelRejectedError("VIDEO_TOO_LONG", "O vídeo passa de 30 segundos.");
      return {
        mp4: Buffer.alloc(this.output.mp4Bytes, 1),
        poster: Buffer.alloc(this.output.posterBytes, 2),
        durationMs: sniffed.info.durationMs,
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
      };
    } finally {
      this.inFlight -= 1;
    }
  }
}

let current: ReelTranscoder | undefined;
export function getReelTranscoder(): ReelTranscoder {
  return (current ??= new FfmpegTranscoder());
}
/** Só para testes: injeta o Fake. */
export function setReelTranscoder(transcoder: ReelTranscoder | undefined): void {
  current = transcoder;
}
