// MP4 mínimo (só as caixas que o API lê): ftyp + moov(mvhd + trak(tkhd)) + mdat. Tudo fictício, sem vídeo real.
function box(type: string, ...parts: Buffer[]): Buffer {
  const payload = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(payload.length + 8, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, payload]);
}

export function fakeMp4(opts: { seconds: number; width?: number; height?: number; rotate90?: boolean; brand?: string; moovLast?: boolean; padBytes?: number }): Buffer {
  const timescale = 1000;
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(timescale, 12);
  mvhd.writeUInt32BE(Math.round(opts.seconds * timescale), 16);
  const tkhd = Buffer.alloc(84);
  const matrixAt = 40;
  if (opts.rotate90) {
    tkhd.writeInt32BE(0, matrixAt);
    tkhd.writeInt32BE(0x10000, matrixAt + 4);
  } else {
    tkhd.writeInt32BE(0x10000, matrixAt);
  }
  tkhd.writeUInt32BE((opts.width ?? 720) * 65536, matrixAt + 36);
  tkhd.writeUInt32BE((opts.height ?? 1280) * 65536, matrixAt + 40);
  const ftyp = box("ftyp", Buffer.from(opts.brand ?? "isom", "latin1"), Buffer.alloc(4), Buffer.from(opts.brand ?? "isom", "latin1"));
  const moov = box("moov", box("mvhd", mvhd), box("trak", box("tkhd", tkhd)));
  const mdat = box("mdat", Buffer.alloc(opts.padBytes ?? 64, 7));
  return Buffer.concat(opts.moovLast ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}

export const BOUNDARY = "----reels";
export function multipartBody(file: Buffer, filename = "video.mp4", contentType = "video/mp4"): Buffer {
  const head = Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  return Buffer.concat([head, file, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]);
}
