import { BlockList, isIP } from "node:net";

// SEC-22 (ST-36): TRUST_PROXY_CIDR em produção só aceita rede PRIVADA/loopback e faixa estreita.
// O que a API confia no X-Forwarded-For define quem pode ditar o IP do cliente (e, portanto, o limite de login):
// uma faixa pública larga (0.0.0.0/1, 8.0.0.0/8…) reabriria a forja do cabeçalho por engano do operador.

type PrivateBlock = { network: string; prefix: number; family: "ipv4" | "ipv6" };

// Redes em que o proxy (Caddy na rede interna do Docker, loopback) pode estar. O prefixo é o MÍNIMO aceito
// (a faixa informada não pode ser MAIOR que o bloco privado que a contém).
const PRIVATE_BLOCKS: PrivateBlock[] = [
  { network: "10.0.0.0", prefix: 8, family: "ipv4" },
  { network: "172.16.0.0", prefix: 12, family: "ipv4" },
  { network: "192.168.0.0", prefix: 16, family: "ipv4" },
  { network: "127.0.0.0", prefix: 8, family: "ipv4" },
  { network: "fc00::", prefix: 7, family: "ipv6" },
  { network: "::1", prefix: 128, family: "ipv6" },
];

const blocks = PRIVATE_BLOCKS.map((b) => {
  const list = new BlockList();
  list.addSubnet(b.network, b.prefix, b.family);
  return { ...b, list };
});

// null = aceito; senão, o motivo (em português) para o operador.
export function trustProxyEntryProblem(entry: string): string | null {
  const [address, prefixText, ...extra] = entry.split("/");
  const family = isIP(address);
  if (family === 0 || extra.length > 0) return `"${entry}" não é um IP ou CIDR válido`;
  const maxPrefix = family === 4 ? 32 : 128;
  let prefix = maxPrefix;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > maxPrefix) return `"${entry}" tem prefixo inválido`;
    prefix = Number(prefixText);
  }
  const type = family === 4 ? "ipv4" : "ipv6";
  const block = blocks.find((b) => b.family === type && b.list.check(address, type));
  if (!block) return `"${entry}" não é rede privada nem loopback: o proxy confiável tem de estar numa rede interna (10/8, 172.16/12, 192.168/16, 127/8, fc00::/7, ::1)`;
  if (prefix < block.prefix) return `"${entry}" é larga demais (mínimo /${block.prefix} dentro de ${block.network}/${block.prefix}); use a faixa exata do proxy, de preferência /32 do IP fixo`;
  return null;
}

export function assertTrustProxyList(list: string[]): void {
  const problems = list.map(trustProxyEntryProblem).filter((p): p is string => p !== null);
  if (problems.length > 0) throw new Error(`TRUST_PROXY_CIDR recusado em produção: ${problems.join("; ")}.`);
}

// SEC-24: o endereço da CONEXÃO (socket) é de rede interna (privada ou loopback)? Aceita o alias IPv4-mapeado
// (`::ffff:172.18.0.3`, como o Node mostra num socket dual-stack).
export function isPrivateAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  let value = address.split("%")[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) value = mapped[1];
  const family = isIP(value);
  if (family === 0) return false;
  const type = family === 4 ? "ipv4" : "ipv6";
  return blocks.some((b) => b.family === type && b.list.check(value, type));
}
