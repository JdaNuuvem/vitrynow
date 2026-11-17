FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
# openssl TAMBÉM no build: com ele o Prisma baixa (na instalação) os engines do OpenSSL 3.0, os mesmos que a imagem final usa.
# Sem isso o `prisma migrate deploy` baixava o engine na PRIMEIRA execução, o que falha na rede `data` (internal: sem internet).
RUN apk add --no-cache openssl
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db/package.json packages/db/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY apps/api/package.json apps/api/package.json
# Build reproduzível: respeita o pnpm-lock.yaml (falha se package.json e lock divergirem).
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps/api apps/api
# @meucardapio/db e @meucardapio/shared-types resolvem pra src/*.ts em dev (via tsx, que
# habilita a condição "development" do package.json), mas em produção (node puro, sem tsx)
# precisam do dist/ compilado — sem isso, "node dist/server.js" quebra tentando executar
# TypeScript cru (SyntaxError: Unexpected identifier 'global').
RUN pnpm --filter @meucardapio/db generate
RUN pnpm --filter @meucardapio/shared-types build
RUN pnpm --filter @meucardapio/db build
RUN pnpm --filter @meucardapio/api build

FROM node:20-alpine
WORKDIR /repo
RUN corepack enable
# Sem isso, o Prisma não consegue detectar a versão do OpenSSL em runtime (comando
# `openssl` ausente) e cai no engine errado mesmo com o binaryTarget certo gerado — ver
# packages/db/prisma/schema.prisma.
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
# Não roda como root: o código fica de root (somente leitura para o app). Única exceção: a pasta de
# engines do Prisma, onde o `prisma migrate deploy` (serviço "migrate") verifica/grava o engine.
RUN chown -R node:node /repo/node_modules/.pnpm/@prisma+engines*/node_modules/@prisma/engines
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
