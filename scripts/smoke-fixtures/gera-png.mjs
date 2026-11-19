// Gera um PNG REAL (válido, RGB, gradiente) para o smoke de upload: node gera-png.mjs <saida.png> <largura> <altura>. Sem dependências.
import fs from 'node:fs';
import zlib from 'node:zlib';
const [out, w, h] = [process.argv[2], Number(process.argv[3] || 64), Number(process.argv[4] || 64)];
if (!out) { console.error('uso: gera-png.mjs <saida.png> [largura] [altura]'); process.exit(2); }
const tab = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = tab[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (tipo, dados) => { const t = Buffer.from(tipo, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(dados.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([len, t, dados, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
const linhas = Buffer.alloc((w * 3 + 1) * h);
for (let y = 0; y < h; y++) { const o = y * (w * 3 + 1); linhas[o] = 0; for (let x = 0; x < w; x++) { linhas[o + 1 + x * 3] = (x * 255 / w) | 0; linhas[o + 2 + x * 3] = (y * 255 / h) | 0; linhas[o + 3 + x * 3] = 120; } }
fs.writeFileSync(out, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(linhas)), chunk('IEND', Buffer.alloc(0))]));
