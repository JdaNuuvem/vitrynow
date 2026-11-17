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
MFA_HMAC_KEY=$(rnd)$(rnd)
API_INTERNAL_SECRET=$(rnd)$(rnd)
COOKIE_SECURE=false   # o smoke é http (sem TLS)
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
  "require('http').createServer((q,s)=>s.end(JSON.stringify({xff:q.headers['x-forwarded-for']||null,ip:q.socket.remoteAddress,secret:q.headers['x-internal-service-secret']||null,visitor:q.headers['x-visitor-ip']||null}))).listen(8080)" >/dev/null

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

# Fuzz de caminho: nenhuma variação pode chegar ao handler admin (que responderia 2xx, 401 ou 403).
# 404/400/405 = barrado no Caddy ou rota inexistente na API.
leak=""
for p in "/api/admin/notices" "/API/ADMIN/notices" "/api/Admin/notices" "//api/admin/notices" "/api//admin/notices" \
         "/api/admin/./notices" "/api/./admin/notices" "/api/x/../admin/notices" "/api/%61dmin/notices" "/api/admin%2fnotices" \
         "/api/admin/" "/api/admin" "/api/admin/notices/" "/api/admin/notices%00" "/api/admin;x=1/notices"; do
  c="$(curl -s --path-as-is -o /dev/null -w '%{http_code}' -X POST -H 'x-admin-token: x' -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT$p")"
  case "$c" in 404|400|405|421|000) ;; *) leak="$leak $p=$c";; esac
done
[ -z "$leak" ] && check ok "15 variações de caminho de /api/admin/* (caixa, //, %61, ../, ;, %00) não chegam ao handler" || check fail "variações que passaram do Caddy:$leak"

echo "== 6 X-Forwarded-For forjado não chega ao backend"
# o eco (node:20-alpine) pode demorar a abrir a porta: espera até 30 s por uma resposta não vazia
r=""
for i in $(seq 1 15); do
  r="$(curl -s -H 'X-Forwarded-For: 6.6.6.6, 7.7.7.7' "http://127.0.0.1:$PORT/__xff")"
  [ -n "$r" ] && break; sleep 2
done
echo "   backend recebeu: $r"
if [ -z "$r" ]; then
  echo "   DIAGNÓSTICO: eco=$(docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}}' "$PROJ-xffecho" 2>&1)"
  echo "   --- logs do eco:"; docker logs --tail 5 "$PROJ-xffecho" 2>&1 | sed 's/^/   /'
  echo "   --- status direto do eco pela rede do compose:"
  docker run --rm --network "${PROJ}_default" node:20-alpine node -e "require('http').get('http://xffecho:8080',r=>{console.log('eco responde',r.statusCode)}).on('error',e=>console.log('eco inacessível:',e.code))" 2>&1 | sed 's/^/   /'
  echo "   --- caddy:"; "${DC[@]}" logs --tail 8 caddy 2>&1 | sed 's/^/   /'
fi
case "$r" in *6.6.6.6*|*7.7.7.7*) check fail "XFF forjado chegou ao backend";; *'"xff":"'*) check ok "XFF do cliente descartado; Caddy envia o IP real da conexão";; *) check fail "resposta inesperada: $r";; esac

echo "== 6e Caddy remove x-internal-service-secret e x-visitor-ip vindos da internet (SEC-24)"
# controle: DENTRO da rede o eco devolve os cabeçalhos se eles chegarem (senão o teste abaixo seria vazio)
ctl="$(docker run --rm --network "${PROJ}_default" node:20-alpine node -e "require('http').get('http://xffecho:8080',{headers:{'x-internal-service-secret':'ctl-secreto','x-visitor-ip':'9.9.9.9'}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>console.log(b))})" 2>&1)"
case "$ctl" in *ctl-secreto*9.9.9.9*|*9.9.9.9*ctl-secreto*) check ok "controle: o eco devolve os dois cabeçalhos quando eles CHEGAM (o teste abaixo não é vazio)";; *) check fail "controle falhou: o eco não devolveu os cabeçalhos ($ctl)";; esac
# pela internet (via Caddy), com variações de caixa: nada pode chegar ao backend
leak=""
for h in "X-Internal-Service-Secret: forjado-1" "x-internal-service-secret: forjado-2" "X-INTERNAL-SERVICE-SECRET: forjado-3"; do
  r="$(curl -s -H "$h" -H 'X-Visitor-IP: 6.6.6.6' "http://127.0.0.1:$PORT/__xff")"
  case "$r" in *forjado*|*6.6.6.6*) leak="$leak [$h => $r]";; esac
  case "$r" in *'"secret":null'*'"visitor":null'*) ;; *) leak="$leak [resposta inesperada: $r]";; esac
done
[ -z "$leak" ] && check ok "3 variações de caixa do x-internal-service-secret + x-visitor-ip forjado: nenhum chega ao backend" || check fail "cabeçalho de serviço vindo da internet chegou ao backend:$leak"

echo "== 6b trustProxy: CIDR confiável = IP real do Caddy; XFF forjado não escapa do limite de login"
CIP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$("${DC[@]}" ps -q caddy)")"
TPC="$("${DC[@]}" exec -T api printenv TRUST_PROXY_CIDR | tr -d '\r')"
echo "   caddy=$CIP  TRUST_PROXY_CIDR(api)=$TPC"
if [ -n "$CIP" ] && [ "$TPC" = "$CIP/32" ]; then check ok "a API confia só no IP do Caddy ($TPC)"
else check fail "TRUST_PROXY_CIDR ($TPC) não é o IP do Caddy ($CIP/32): rate limit compartilhado ou forjável (ST-02c)"; fi
got429=0
for i in $(seq 1 14); do
  c="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.9.$i.$i" \
       -d '{"email":"nao@existe.invalid","password":"errada-errada"}' "http://127.0.0.1:$PORT/auth/login")"
  [ "$c" = 429 ] && got429=1
done
if [ "$got429" = 1 ]; then check ok "14 logins, cada um com X-Forwarded-For diferente, bateram no limite (429): cabeçalho forjado não burla o rate limit"
else check fail "nenhum 429 em 14 logins com XFF forjado: o limite pode ser burlado (B04)"; fi

echo "== 6c Postgres em UTC (colunas TIMESTAMP sem fuso; API-12 usa AT TIME ZONE 'UTC')"
tz="$("${DC[@]}" exec -T postgres psql -U meucardapio -d meucardapio -At -c "show timezone" | tr -d '\r')"
ltz="$("${DC[@]}" exec -T postgres psql -U meucardapio -d meucardapio -At -c "show log_timezone" | tr -d '\r')"
same="$("${DC[@]}" exec -T postgres psql -U meucardapio -d meucardapio -At -c "select (localtimestamp(0) = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(0))" | tr -d '\r')"
{ [ "$tz" = UTC ] || [ "$tz" = Etc/UTC ]; } && check ok "timezone do servidor = $tz" || check fail "timezone do servidor = '$tz' (esperado UTC)"
{ [ "$ltz" = UTC ] || [ "$ltz" = Etc/UTC ]; } && check ok "log_timezone = $ltz" || check fail "log_timezone = '$ltz' (esperado UTC)"
[ "$same" = t ] && check ok "hora local do banco == CURRENT_TIMESTAMP AT TIME ZONE 'UTC' (sem deslocamento)" || check fail "hora local do banco difere de UTC"

echo "== 6d segredo de serviço web→API (SEC-24) e SSR pela rede interna"
SECRET="$(grep '^API_INTERNAL_SECRET=' "$ENVF" | cut -d= -f2-)"
hw="$("${DC[@]}" exec -T web printenv API_INTERNAL_SECRET | tr -d '\r\n' | sha256sum | cut -c1-16)"
ha="$("${DC[@]}" exec -T api printenv API_INTERNAL_SECRET | tr -d '\r\n' | sha256sum | cut -c1-16)"
[ -n "$hw" ] && [ "$hw" = "$ha" ] && check ok "web e API têm o MESMO segredo de serviço (hash $hw; o valor não é impresso)" || check fail "segredo diferente entre web ($hw) e API ($ha)"
iu="$("${DC[@]}" exec -T web printenv API_INTERNAL_URL | tr -d '\r\n')"
[ "$iu" = "http://api:3001" ] && check ok "web chama a API pela rede interna ($iu)" || check fail "API_INTERNAL_URL do web = '$iu' (esperado http://api:3001)"
# o segredo NÃO pode estar na imagem (ENV/ARG) nem no que o navegador baixa
img="$("${DC[@]}" images web --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | head -1)"
if docker image inspect "$img" 2>/dev/null | grep -qF "$SECRET"; then check fail "o segredo aparece na CONFIG da imagem $img (ENV/ARG de build)"; else check ok "segredo ausente da config da imagem web (só existe em tempo de execução)"; fi
html="$(curl -s "http://127.0.0.1:$PORT/")"; leak=0; n=0
chunks="$(printf '%s' "$html" | grep -oE '/_next/static/[^"'"'"' )]+\.(js|css)' | sort -u | head -40)"
for u in $chunks; do n=$((n+1)); if curl -s "http://127.0.0.1:$PORT$u" | grep -qF "$SECRET"; then leak=1; echo "   VAZOU em $u"; fi; done
if printf '%s' "$html" | grep -qF "$SECRET"; then leak=1; echo "   VAZOU no HTML da home"; fi
if [ "$n" -ge 3 ] && [ "$leak" = 0 ]; then check ok "segredo ausente do HTML e de $n arquivos estáticos que o navegador baixa"; else check fail "vazamento ($leak) ou poucos arquivos conferidos ($n)"; fi
# SSR de ponta a ponta: cadastra uma loja de teste e abre o cardápio dela; o nome só vem no HTML se o servidor do web alcançou a API
slug="smoke-ssr-$RANDOM"
rc="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"storeName\":\"Loja Smoke SSR\",\"slug\":\"$slug\",\"code\":\"SM$RANDOM\",\"email\":\"smoke$RANDOM@exemplo.invalid\",\"password\":\"SenhaLonga-12345\"}" "http://127.0.0.1:$PORT/auth/register")"
page="$(curl -s -w '|%{http_code}' "http://127.0.0.1:$PORT/loja/$slug")"
if [ "$rc" = 201 ] && [ "${page##*|}" = 200 ] && printf '%s' "$page" | grep -q "Loja Smoke SSR"; then check ok "SSR: /loja/$slug traz o nome da loja no HTML (o servidor do web alcançou a API por http://api:3001)"
else check fail "SSR não trouxe a loja (cadastro=$rc, página=${page##*|}); o web pode estar caindo no plano B do navegador"; fi

echo "== 7 backup verificado"
for i in $(seq 1 30); do [ -s "$ROOT/infra/backups/LAST_OK" ] && break; sleep 2; done
f="$(ls -1 "$ROOT"/infra/backups/*.dump 2>/dev/null | tail -1)"
if [ -n "$f" ]; then sz="$(wc -c < "$f" | tr -d ' ')"; [ "$sz" -gt 20000 ] && check ok "dump $(basename "$f") com $sz bytes" || check fail "dump pequeno: $sz bytes"; else check fail "nenhum dump gerado"; fi
pd="$("${DC[@]}" exec -T postgres-backup stat -c %a /backups | tr -d '\r')"
pf="$("${DC[@]}" exec -T postgres-backup sh -c 'stat -c %a /backups/*.dump /backups/*.sha256 /backups/LAST_OK | sort -u | tr "\n" " "' | tr -d '\r')"
[ "$pd" = 700 ] && check ok "pasta de backups com modo 700" || check fail "pasta de backups com modo $pd (esperado 700)"
[ "$pf" = "600 " ] && check ok "dump, .sha256 e LAST_OK com modo 600" || check fail "arquivos de backup com modos '$pf' (esperado 600)"
bh="$("${DC[@]}" exec -T postgres-backup /bin/sh /scripts/healthcheck.sh >/dev/null 2>&1 && echo ok || echo no)"; [ "$bh" = ok ] && check ok "healthcheck do backup saudável" || check fail "healthcheck do backup falhou"

echo "== 8 compose recusa .env sem segredos"
for v in JWT_SECRET MFA_HMAC_KEY API_INTERNAL_SECRET POSTGRES_PASSWORD WEB_ORIGIN; do
  grep -v "^$v=" "$ENVF" > "$ENVF.sem"
  out="$(docker compose -p "$PROJ-neg" -f "$ROOTW/infra/docker-compose.yml" --env-file "$(cygpath -m "$ENVF.sem")" config -q 2>&1)"
  case "$out" in *"required variable $v is missing"*) check ok "sem $v o compose recusa: $(echo "$out" | head -1 | cut -c1-90)";; *) check fail "compose aceitou .env sem $v";; esac
done
rm -f "$ENVF.sem"

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
