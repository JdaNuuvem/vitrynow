# Caddy com o módulo de limite de taxa (SEC-26 / ST-44). O Caddy padrão NÃO limita requisições por IP; o módulo
# github.com/mholt/caddy-ratelimit (do próprio autor do Caddy) entra por compilação com xcaddy.
# REPRODUTÍVEL: o módulo é travado por COMMIT (imutável), não por tag nem por "latest". Para atualizar, troque o commit
# conscientemente, rode scripts/smoke-stack.sh e registre no BOARD (INF-18).
FROM caddy:2-builder AS builder
ARG RATELIMIT_COMMIT=5625512f24f6f59d6f64fb3aafe5eecff0b286db
RUN xcaddy build --with github.com/mholt/caddy-ratelimit@${RATELIMIT_COMMIT}

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Falha o build se o módulo não entrou no binário (o Caddyfile deixaria de carregar em silêncio no futuro).
RUN caddy list-modules | grep -q '^http.handlers.rate_limit$'
