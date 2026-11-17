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
# pnpm FIXO (INF-22): a versão e o hash vêm do `packageManager` do package.json (o corepack as respeita e verifica o hash); sem isso o corepack baixava a
# ÚLTIMA (12.21.0 contra 12.8.1 do repositório) e o `allowBuilds` pode se comportar diferente. A conferência abaixo falha o build se a versão em uso divergir do campo.
RUN node -e "const v=require('./package.json').packageManager.split('@')[1].split('+')[0],r=require('child_process').execSync('pnpm -v').toString().trim();if(v!==r){console.error('pnpm da imagem '+r+' difere do packageManager '+v);process.exit(1)}console.log('pnpm '+r+' (fixo pelo packageManager)')"
# Build reproduzível: respeita o pnpm-lock.yaml (falha se package.json e lock divergirem). O --filter evita o erro do pnpm 12.8.1 "importer ausente" (esta imagem não copia
# os package.json dos outros apps; o pnpm 12.21.0 deixava passar) e instala só o que o app precisa.
RUN pnpm install --frozen-lockfile --filter "@meucardapio/api..."
# SEC-34: o `bcrypt` nativo é COMPILADO DO FONTE aqui (decisão do Atlas). O pacote traz binários pré-compilados e o pnpm NEGA o script de instalação (`bcrypt: false` em
# allowBuilds); este passo compila contra os cabeçalhos do Node da própria imagem (npm_config_nodedir: sem baixar nada), REMOVE o `prebuilds/` (para que só o binário
# compilado aqui possa carregar) e FALHA o build se o binário não existir ou se o pacote não carregar. python3/make/g++ só nesta etapa: a imagem final não os tem.
ENV npm_config_nodedir=/usr/local
# node-gyp DIRETO, uma vez, dentro da pasta do pacote: `npm rebuild bcrypt` a partir de apps/api compilava o MESMO pacote duas vezes em paralelo no layout do pnpm
# (EEXIST em build/node_gyp_bins e arquivos .d.raw corrompidos: medido em 17/11).
RUN apk add --no-cache python3 make g++  && B="$(dirname "$(node -p "require.resolve('bcrypt/package.json', { paths: ['/repo/apps/api'] })")")"  && (cd "$B" && node /usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --nodedir=/usr/local)  && rm -rf "$B/prebuilds"  && test -f "$B/build/Release/bcrypt_lib.node" && test ! -e "$B/prebuilds"  && (cd /repo/apps/api && node -e "const b=require('bcrypt');if(!b.compareSync('x',b.hashSync('x',4)))process.exit(1);console.log('bcrypt compilado do fonte carregou: '+require('path').relative('/repo',require.resolve('bcrypt/package.json')))")
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
