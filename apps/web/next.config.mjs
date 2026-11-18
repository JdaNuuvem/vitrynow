import { securityHeaders } from "./lib/securityHeaders.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bundle mínimo (só o necessário pra rodar, sem a árvore de node_modules do monorepo) —
  // o Dockerfile copia só .next/standalone em vez do workspace inteiro. Só liga dentro do
  // build Docker (NEXT_OUTPUT_STANDALONE=1): a etapa de "trace" do standalone cria symlinks,
  // e isso quebra `next build` local no Windows sem Modo de Desenvolvedor/Administrador.
  output: process.env.NEXT_OUTPUT_STANDALONE ? "standalone" : undefined,
  // NG-07: CSP e cabeçalhos de segurança em todas as rotas (lib/securityHeaders.mjs; a API é a
  // NEXT_PUBLIC_API_URL, a mesma fixada no build). Sem `poweredByHeader` para não anunciar a versão.
  poweredByHeader: false,
  async headers() {
    const dev = process.env.NODE_ENV !== "production";
    const common = securityHeaders({ apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001", dev });
    return [
      // ST-56: a rota de redefinição de senha nunca manda Referer (o endereço dela carrega o token no fragmento/query legada).
      // Tem regra PRÓPRIA (com os mesmos cabeçalhos, só o Referrer-Policy trocado) e fica FORA da regra global, para o resultado
      // não depender da ordem em que o Next aplica duas regras que definem o mesmo cabeçalho.
      { source: "/reset-senha", headers: common.map((h) => (h.key === "Referrer-Policy" ? { ...h, value: "no-referrer" } : h)) },
      { source: "/((?!reset-senha$).*)", headers: common },
    ];
  },
};

export default nextConfig;
