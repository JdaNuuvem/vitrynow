FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/web/package.json apps/web/package.json
# Build reproduzível: respeita o pnpm-lock.yaml (falha se package.json e lock divergirem).
RUN pnpm install --frozen-lockfile
COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_OUTPUT_STANDALONE=1
# @meucardapio/shared-types resolve pra src/index.ts em dev (via tsx); o build do Next (sem
# tsx) precisa do dist/ compilado.
RUN pnpm --filter @meucardapio/shared-types build
# output: "standalone" (next.config.mjs) resolve as dependências reais usadas em runtime
# (inclusive o pacote workspace @meucardapio/shared-types) sem precisar dos symlinks do
# node_modules da raiz do monorepo na imagem final.
RUN pnpm --filter @meucardapio/web build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# Não roda como root; o Next grava cache em .next/cache, por isso os arquivos pertencem ao usuário node.
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
