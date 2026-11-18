# Base FIXA por digest (INF-26): node 24.22.3 / alpine. Atualizar so de proposito (docs/RUNBOOK-infra.md, 'Atualizar a imagem base do Node').
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/web/package.json apps/web/package.json
# pnpm FIXO (INF-22): a versão e o hash vêm do `packageManager` do package.json (o corepack as respeita e verifica o hash); sem isso o corepack baixava a
# ÚLTIMA (12.21.0 contra 12.8.1 do repositório). A conferência abaixo falha o build se a versão em uso divergir do campo.
RUN node -e "const v=require('./package.json').packageManager.split('@')[1].split('+')[0],r=require('child_process').execSync('pnpm -v').toString().trim();if(v!==r){console.error('pnpm da imagem '+r+' difere do packageManager '+v);process.exit(1)}console.log('pnpm '+r+' (fixo pelo packageManager)')"
# Build reproduzível: respeita o pnpm-lock.yaml (falha se package.json e lock divergirem). O --filter evita o erro do pnpm 12.8.1 "importer ausente" (esta imagem não copia
# os package.json dos outros apps; o pnpm 12.21.0 deixava passar) e instala só o que o app precisa.
RUN pnpm install --frozen-lockfile --filter "@meucardapio/web..."
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

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
# Não roda como root; o Next grava cache em .next/cache, por isso os arquivos pertencem ao usuário node.
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
