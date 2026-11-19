import { securityHeaders } from "./lib/securityHeaders.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bundle mínimo (só o necessário pra rodar, sem a árvore de node_modules do monorepo) —
  // o Dockerfile copia só .next/standalone em vez do workspace inteiro. Só liga dentro do
  // build Docker (NEXT_OUTPUT_STANDALONE=1): a etapa de "trace" do standalone cria symlinks,
  // e isso quebra `next build` local no Windows sem Modo de Desenvolvedor/Administrador.
  output: process.env.NEXT_OUTPUT_STANDALONE ? "standalone" : undefined,
  poweredByHeader: false,
  async headers() {
    const dev = process.env.NODE_ENV !== "production";
    const common = securityHeaders({ apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001", dev });
    const privateLink = common.map((header) =>
      header.key === "Referrer-Policy" ? { ...header, value: "no-referrer" } : header,
    );
    return [
      { source: "/reset-senha", headers: privateLink },
      { source: "/loja/:slug/m/:token", headers: privateLink },
      { source: "/((?!reset-senha$|loja/[^/]+/m/[^/]+$).*)", headers: common },
    ];
  },
};

export default nextConfig;

