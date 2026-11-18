/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Bundle mínimo (só o necessário pra rodar, sem a árvore de node_modules do monorepo) —
  // o Dockerfile copia só .next/standalone em vez do workspace inteiro. Só liga dentro do
  // build Docker (NEXT_OUTPUT_STANDALONE=1): a etapa de "trace" do standalone cria symlinks,
  // e isso quebra `next build` local no Windows sem Modo de Desenvolvedor/Administrador.
  output: process.env.NEXT_OUTPUT_STANDALONE ? "standalone" : undefined,
  // ST-56: a rota de redefinição de senha nunca manda Referer (o endereço dela carrega o token no fragmento/query legada).
  async headers() {
    return [{ source: "/reset-senha", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};

export default nextConfig;
