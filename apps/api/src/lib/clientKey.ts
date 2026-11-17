import { isIP } from "node:net";

// SEC-23 (ST-37, ST-37b): chave do cliente para limite de tentativas e de requisições.
// Antes a chave era o IP inteiro do socket, então:
//  - quem recebe uma faixa IPv6 /64 (padrão de qualquer provedor ou VPS: 2^64 endereços) trocava de endereço a cada
//    tentativa e nunca atingia o limite;
//  - o alias IPv4-mapeado `::ffff:a.b.c.d` contava como cliente diferente de `a.b.c.d`, dobrando o limite.
// Agora: IPv6 ⇒ prefixo /64; IPv4-mapeado ⇒ o IPv4; IPv4 ⇒ ele mesmo; ilegível ⇒ um balde único e restritivo.

export const UNKNOWN_CLIENT = "desconhecido";

function expandIpv6(address: string): number[] | null {
  let text = address.split("%")[0].toLowerCase(); // sem zona (fe80::1%eth0)
  // forma com IPv4 embutido no fim (::ffff:1.2.3.4): converte os 4 octetos em 2 grupos
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (isIP(tail) !== 4) return null;
    const o = tail.split(".").map(Number);
    text = text.slice(0, lastColon + 1) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0 || (halves.length === 2 && missing < 1)) return null;
  const groups = [...head, ...(halves.length === 2 ? new Array(missing).fill("0") : []), ...rest];
  if (groups.length !== 8) return null;
  const parsed = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return parsed.some(Number.isNaN) ? null : parsed;
}

export function clientKey(ip: string | undefined | null): string {
  if (!ip) return UNKNOWN_CLIENT;
  const family = isIP(ip.split("%")[0]);
  if (family === 4) return ip;
  if (family !== 6) return UNKNOWN_CLIENT;
  const groups = expandIpv6(ip);
  if (!groups) return UNKNOWN_CLIENT;
  // IPv4-mapeado (::ffff:a.b.c.d) vale como o próprio IPv4
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  }
  // demais IPv6: os 64 bits de rede identificam o cliente (a /64 inteira divide o mesmo limite)
  return groups.slice(0, 4).map((g) => g.toString(16)).join(":") + "::/64";
}
