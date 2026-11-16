#!/bin/bash
# Smoke da stack de produção (infra/docker-compose.yml) 100% local e descartável (INF-02/03/04/06, T14).
# Sobe postgres + migrate + api + web + caddy + backup com SEGREDOS ALEATÓRIOS DESCARTÁVEIS, confere:
#   1 migrações aplicadas pelo serviço one-shot      5 /api/admin/* bloqueado no Caddy (404 "not found")
#   2 /health via Caddy                              6 X-Forwarded-For forjado NÃO chega ao backend (B04)
#   3 api/web/postgres sem porta publicada           7 backup verificado gerado e saudável (B05)
#   4 api/web rodam sem root
# Sem TLS/DNS/e-mail/serviços externos. Porta do Caddy: SMOKE_PORT (padrão 55443, faixa da Hopper).
set -uo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SMOKE_PORT:-55443}"; export SMOKE_PORT="$PORT"
PROJ="mc-smoke-hopper"
ENVF="$ROOT/infra/.smoke.env"; PASS=0; FAILS=0   # dentro do worktree (gitignored por .env.*): o compose no Windows não lê /tmp do Git Bash
rnd() { node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))"; }
cat > "$ENVF" <<EOF
POSTGRES_PASSWORD=$(rnd)
JWT_SECRET=$(rnd)$(rnd)
WEB_ORIGIN=http://localhost:$PORT
NEXT_PUBLIC_API_URL=http://localhost:$PORT
DOMAIN=:80
ACME_EMAIL=smoke@exemplo.invalid
APP_VERSION=smoke
EOF
ROOTW="$(cygpath -m "$ROOT")"   # docker.exe (Windows) precisa de C:/...
DC=(docker compose -p "$PROJ" -f "$ROOTW/infra/docker-compose.yml" -f "$ROOTW/infra/docker-compose.smoke.yml" --env-file "$ROOTW/infra/.smoke.env")
check() { if [ "$1" = ok ]; then PASS=$((PASS+1)); echo "  [ok]    $2"; else FAILS=$((FAILS+1)); echo "  [FALHA] $2"; fi; }
cleanup() {
  [ "${KEEP:-0}" = 1 ] && { echo "KEEP=1: stack mantida ($PROJ), porta $PORT"; return; }
  "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1; docker rm -f "$PROJ-xffecho" >/dev/null 2>&1
  rm -f "$ENVF" "$ROOT/infra/Caddyfile.smoke" "$ROOT"/infra/backups/*.dump "$ROOT"/infra/backups/*.sha256 "$ROOT"/infra/backups/LAST_OK
}
trap cleanup EXIT

# Caddyfile do smoke = o REAL + uma rota de eco para provar o que o backend recebe
awk '/^\thandle \{$/ && !done { print "\thandle /__xff {\n\t\treverse_proxy xffecho:8080\n\t}"; done=1 } { print }' "$ROOT/infra/Caddyfile" > "$ROOT/infra/Caddyfile.smoke"
mkdir -p "$ROOT/infra/backups"

echo "== validando e subindo a stack ($PROJ)"
"${DC[@]}" config -q || { echo "compose inválido"; exit 1; }
"${DC[@]}" up -d --build 2>&1 | tail -5
docker run -d --name "$PROJ-xffecho" --network "${PROJ}_default" --network-alias xffecho node:20-alpine node -e \
  "require('http').createServer((q,s)=>s.end(JSON.stringify({xff:q.headers['x-forwarded-for']||null,ip:q.socket.remoteAddress}))).listen(8080)" >/dev/null

echo "== aguardando saúde (até 180s)"
for i in $(seq 1 90); do
  st="$("${DC[@]}" ps api --format '{{.Health}}' 2>/dev/null)"; [ "$st" = healthy ] && break; sleep 2
done
[ "$st" = healthy ] && check ok "api saudável" || { check fail "api não ficou saudável ($st)"; "${DC[@]}" logs --tail 30 api migrate; }

echo "== 1 migrações pelo serviço one-shot"
code="$(docker inspect -f '{{.State.ExitCode}}' "$("${DC[@]}" ps -a -q migrate)" 2>/dev/null)"
[ "$code" = 0 ] && check ok "serviço migrate terminou com exit 0" || check fail "migrate exit=$code"
want="$(ls -d "$ROOT"/packages/db/prisma/migrations/*/ | wc -l | tr -d ' ')"
got="$("${DC[@]}" exec -T postgres psql -U meucardapio -d meucardapio -At -c "select count(*) from _prisma_migrations where finished_at is not null")"
[ "$got" = "$want" ] && check ok "$got/$want migrações aplicadas" || check fail "migrações aplicadas: $got de $want"

echo "== 2 /health via Caddy e frontend"
h="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"; [ "$h" = 200 ] && check ok "GET /health = 200 pelo Caddy" || check fail "GET /health = $h"
w="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"; [ "$w" -lt 500 ] && check ok "GET / (web) = $w pelo Caddy" || check fail "GET / = $w"
s="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/stores/nao-existe")"; [ "$s" = 404 ] && check ok "GET /stores/<inexistente> = 404 vindo da API" || check fail "GET /stores/<x> = $s"

echo "== 3 nenhuma porta publicada fora do Caddy"
pub="$(docker ps --filter "label=com.docker.compose.project=$PROJ" --format '{{.Names}}|{{.Ports}}' | grep -E '0\.0\.0\.0|::|127\.0\.0\.1' | grep -v caddy || true)"
[ -z "$pub" ] && check ok "só o caddy publica porta (127.0.0.1:$PORT)" || check fail "portas publicadas: $pub"

echo "== 4 não-root"
for svc in api web; do u="$("${DC[@]}" exec -T $svc id -u 2>/dev/null | tr -d '\r')"; [ -n "$u" ] && [ "$u" != 0 ] && check ok "$svc roda como uid $u" || check fail "$svc roda como root/indeterminado ($u)"; done

echo "== 5 /api/admin/* bloqueado no Caddy"
b="$(curl -s -w '|%{http_code}' -X POST -H 'x-admin-token: qualquer' "http://127.0.0.1:$PORT/api/admin/notices")"
[ "$b" = "not found|404" ] && check ok "POST /api/admin/notices barrado no Caddy ($b)" || check fail "admin alcançou a API: $b"

echo "== 6 X-Forwarded-For forjado não chega ao backend"
r="$(curl -s -H 'X-Forwarded-For: 6.6.6.6, 7.7.7.7' "http://127.0.0.1:$PORT/__xff")"
echo "   backend recebeu: $r"
case "$r" in *6.6.6.6*|*7.7.7.7*) check fail "XFF forjado chegou ao backend";; *'"xff":"'*) check ok "XFF do cliente descartado; Caddy envia o IP real da conexão";; *) check fail "resposta inesperada: $r";; esac

echo "== 7 backup verificado"
for i in $(seq 1 30); do [ -s "$ROOT/infra/backups/LAST_OK" ] && break; sleep 2; done
f="$(ls -1 "$ROOT"/infra/backups/*.dump 2>/dev/null | tail -1)"
if [ -n "$f" ]; then sz="$(wc -c < "$f" | tr -d ' ')"; [ "$sz" -gt 20000 ] && check ok "dump $(basename "$f") com $sz bytes" || check fail "dump pequeno: $sz bytes"; else check fail "nenhum dump gerado"; fi
bh="$("${DC[@]}" exec -T postgres-backup /bin/sh /scripts/healthcheck.sh >/dev/null 2>&1 && echo ok || echo no)"; [ "$bh" = ok ] && check ok "healthcheck do backup saudável" || check fail "healthcheck do backup falhou"

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
