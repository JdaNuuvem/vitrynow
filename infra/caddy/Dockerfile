# Caddy com o módulo de limite de taxa (SEC-26 / ST-44). O Caddy padrão NÃO limita requisições por IP; o módulo
# github.com/mholt/caddy-ratelimit (do próprio autor do Caddy) entra por compilação com xcaddy.
#
# CADEIA DE SUPRIMENTOS (revisão da Nightingale): tudo travado, nada móvel.
#  - imagens oficiais por VERSÃO + DIGEST (a tag 2.11.9 pode ser republicada; o digest não);
#  - módulo por COMMIT (imutável): o repositório só tem a tag v0.1.0, antiga, então tag/latest não servem;
#  - estágio de build com rede (baixa os módulos Go, verificados pelo go.sum de cada módulo); o estágio final NÃO tem
#    toolchain Go nem xcaddy, só o binário;
#  - o build FALHA se o módulo não entrar no binário.
# Para atualizar: troque versão, digest e/ou commit conscientemente, rode scripts/smoke-stack.sh e registre no BOARD (INF-18):
# `caddy version`, `caddy build-info` e o digest da imagem final (o go.sum das dependências Go não fica no repositório).
#   digests: docker buildx imagetools inspect caddy:<versão>-builder|alpine --format '{{.Manifest.Digest}}'
FROM caddy:2.11.9-builder@sha256:f9beaa5ddbe7df6f26ebbcf9cbf44e05a1917b9bba464f0c3229038d7e2e6e13 AS builder
ARG RATELIMIT_COMMIT=5625512f24f6f59d6f64fb3aafe5eecff0b286db
RUN xcaddy build v2.11.9 --with github.com/mholt/caddy-ratelimit@${RATELIMIT_COMMIT}

FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
RUN caddy list-modules | grep -q '^http.handlers.rate_limit$' && caddy version

# Não-root (Nightingale): o binário copiado NÃO leva o setcap da imagem oficial, então não dependemos de capability de arquivo.
# 80/443 funcionam sem root porque o Docker libera portas baixas dentro do container (net.ipv4.ip_unprivileged_port_start=0);
# o smoke prova. /data (conta ACME) e /config precisam ser do usuário para o volume nascer gravável.
RUN mkdir -p /data /config && chown -R 65532:65532 /data /config
USER 65532:65532
