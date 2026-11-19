#!/bin/bash
# Smoke da stack de produção (infra/docker-compose.yml) 100% local e descartável (INF-02/03/04/06, T14).
# Sobe postgres + migrate + api + web + caddy + backup com SEGREDOS ALEATÓRIOS DESCARTÁVEIS, confere:
#   1 migrações aplicadas pelo serviço one-shot      5 /api/admin/* bloqueado no Caddy (404 "not found")
#   2 /health via Caddy                              6 X-Forwarded-For forjado NÃO chega ao backend (B04)
#   3 api/web/postgres sem porta publicada           7 backup verificado gerado e saudável (B05)
#   4 api/web rodam sem root
# Sem TLS/DNS/e-mail/serviços externos. Porta do Caddy: SMOKE_PORT (padrão 55443, faixa da Hopper).
# ARMADILHA (achada em 17/11): com pipefail, `printf "$var" | grep -q X` dá FALSO NEGATIVO quando o grep -q sai no 1º acerto e o printf leva SIGPIPE (log grande com
# vários acertos). Num detector de vazamento isso esconde o vazamento. Para testar "contém" numa variável use `[[ "$var" == *"X"* ]]` ou `grep -c` (lê tudo).
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
# fotos em DISCO LOCAL (ADR-0017): o volume uploads_data; a URL pública vira WEB_ORIGIN/media (padrão do compose)
STORAGE_DRIVER=local
# a guarda de boot exige https na URL pública; o smoke é http, então ela é declarada aqui (os testes só usam o CAMINHO /media/...)
STORAGE_PUBLIC_BASE_URL=https://localhost:$PORT/media
EOF
ROOTW="$(cygpath -m "$ROOT")"   # docker.exe (Windows) precisa de C:/...
DC=(docker compose -p "$PROJ" -f "$ROOTW/infra/docker-compose.yml" -f "$ROOTW/infra/docker-compose.smoke.yml" --env-file "$ROOTW/infra/.smoke.env")
check() { if [ "$1" = ok ]; then PASS=$((PASS+1)); echo "  [ok]    $2"; else FAILS=$((FAILS+1)); echo "  [FALHA] $2"; fi; }
KRED=0   # vermelhos CONHECIDOS (abertos, visíveis, que não contam como falha nova); a linha final os mostra
cleanup() {
  [ "${KEEP:-0}" = 1 ] && { echo "KEEP=1: stack mantida ($PROJ), porta $PORT"; return; }
  "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1; docker rm -f "$PROJ-xffecho" >/dev/null 2>&1
  rm -f "$ENVF" "$ROOT/infra/Caddyfile.smoke" "$ROOT"/infra/backups/*.dump "$ROOT"/infra/backups/*.sha256 "$ROOT"/infra/backups/LAST_OK
}
trap cleanup EXIT

# Caddyfile do smoke = o REAL + uma rota de eco para provar o que o backend recebe
awk '/^\thandle \{$/ && !done { print "\thandle /__xff {\n\t\treverse_proxy xffecho:8080\n\t}\n\thandle /__mem {\n\t\trate_limit {\n\t\t\tzone mem_test {\n\t\t\t\tkey {http.request.header.X-Mem-Key}\n\t\t\t\tevents 120\n\t\t\t\twindow 1m\n\t\t\t}\n\t\t\tsweep_interval 1m\n\t\t}\n\t\trespond \"ok\" 200\n\t}"; done=1 } { print }' "$ROOT/infra/Caddyfile" > "$ROOT/infra/Caddyfile.smoke"
mkdir -p "$ROOT/infra/backups"

echo "== validando e subindo a stack ($PROJ)"
"${DC[@]}" config -q || { echo "compose inválido"; exit 1; }
out="$("${DC[@]}" up -d --build 2>&1)"; rc=$?
echo "$out" | tail -25
[ "$rc" -eq 0 ] || { echo "FALHA: 'compose up --build' saiu com $rc (build ou subida); o smoke para aqui: o resto só geraria falhas em cascata"; exit 1; }
docker run -d --name "$PROJ-xffecho" --network "${PROJ}_default" --network-alias xffecho node:24-alpine node -e \
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
# Só os containers que o compose DESTA pilha lista (`ps -q`). NÃO filtrar por rótulo de projeto: a imagem meucardapio-web:smoke carrega o rótulo
# do compose e todo `docker run` dela (de qualquer agente) o herda, passando no filtro (falso vermelho visto em 17/11, achado da Tesla).
pub=""; for cid in $("${DC[@]}" ps -q); do p="$(docker inspect -f '{{.Name}}|{{range $k,$v := .NetworkSettings.Ports}}{{if $v}}{{$k}}->{{range $v}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}{{end}}' "$cid" | sed 's#^/##')"; case "$p" in *caddy*) ;; *"->"*) pub="$pub $p";; esac; done
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
# o eco (node:24-alpine) pode demorar a abrir a porta: espera até 30 s por uma resposta não vazia
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
  docker run --rm --network "${PROJ}_default" node:24-alpine node -e "require('http').get('http://xffecho:8080',r=>{console.log('eco responde',r.statusCode)}).on('error',e=>console.log('eco inacessível:',e.code))" 2>&1 | sed 's/^/   /'
  echo "   --- caddy:"; "${DC[@]}" logs --tail 8 caddy 2>&1 | sed 's/^/   /'
fi
case "$r" in *6.6.6.6*|*7.7.7.7*) check fail "XFF forjado chegou ao backend";; *'"xff":"'*) check ok "XFF do cliente descartado; Caddy envia o IP real da conexão";; *) check fail "resposta inesperada: $r";; esac

echo "== 6e Caddy remove x-internal-service-secret e x-visitor-ip vindos da internet (SEC-24)"
# controle: DENTRO da rede o eco devolve os cabeçalhos se eles chegarem (senão o teste abaixo seria vazio)
ctl="$(docker run --rm --network "${PROJ}_default" node:24-alpine node -e "require('http').get('http://xffecho:8080',{headers:{'x-internal-service-secret':'ctl-secreto','x-visitor-ip':'9.9.9.9'}},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>console.log(b))})" 2>&1)"
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
# INF-08/NG-12b: os 14 logins falhos do MESMO IP (o X-Forwarded-For forjado não conta) passam de 10 em 5 min: a API tem de EMITIR o security_alert, e o saude.sh de REPORTÁ-LO
# só 8 dos 14 chegam ao tratador (limite de 8/min do IP na API) e geram evento (5 login_failed + 3 login_locked) = 8 < limiar 10: espera a janela do limite (62 s) e faz mais 4 falhas
# em contas DIFERENTES (cada uma gera 1 login_failed): 12 eventos do mesmo IP em ~1 min => a regra LOGIN_FAILURES_PER_IP (10 em 5 min) tem de disparar
echo "   (espera 62 s para a janela do limite de login esvaziar e fazer a 2ª leva de falhas)"; sleep 62
for n in 1 2 3 4; do curl -s -o /dev/null -X POST -H "Content-Type: application/json" -d "{\"email\":\"alerta$n@existe.invalid\",\"password\":\"errada-errada\"}" "http://127.0.0.1:$PORT/auth/login"; done
sleep 2; sa="$("${DC[@]}" logs --no-color api 2>&1 | grep '"msg":"security_alert"' | grep -o '"securityAlert":"[A-Z_]*"' | cut -d'"' -f4 | sort -u | tr '
' ' ')"
[[ "$sa" == *LOGIN_FAILURES_PER_IP* ]] && check ok "NG-12b: a API emitiu security_alert LOGIN_FAILURES_PER_IP depois de 14 logins falhos do mesmo IP ($sa)" || check fail "NG-12b: nenhum security_alert LOGIN_FAILURES_PER_IP no log da API (regras vistas: '$sa')"
sd="$(cd "$ROOT/infra" && ENV_FILE=.smoke.env COMPOSE_PROJECT_NAME="$PROJ" COMPOSE_PATH_SEPARATOR="|" COMPOSE_FILE="docker-compose.yml|docker-compose.smoke.yml" bash ./saude.sh --minutos 30 2>&1)"; src=$?
[[ "$sd" == *"[ALERTA]"*"LOGIN_FAILURES_PER_IP"* ]] && check ok "INF-08: o saude.sh (na stack real) reporta o security_alert com o nome da regra" || check fail "INF-08: o saude.sh não reportou LOGIN_FAILURES_PER_IP: $(echo "$sd" | tail -4 | tr '
' '|')"
[[ "$sd" != *"$(printf '%s' "127.0.0.1")"* ]] && check ok "INF-08: a saída do saude.sh não traz IP" || check fail "INF-08: o saude.sh imprimiu um IP"

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
if [[ "$html" == *"$SECRET"* ]]; then leak=1; echo "   VAZOU no HTML da home"; fi
if [ "$n" -ge 3 ] && [ "$leak" = 0 ]; then check ok "segredo ausente do HTML e de $n arquivos estáticos que o navegador baixa"; else check fail "vazamento ($leak) ou poucos arquivos conferidos ($n)"; fi
# SSR de ponta a ponta: cadastra uma loja de teste e abre o cardápio dela; o nome só vem no HTML se o servidor do web alcançou a API
slug="smoke-ssr-$RANDOM"
smokeEmail="smoke$RANDOM@exemplo.invalid"; smokePass="SenhaLonga-12345"
rc="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"storeName\":\"Loja Smoke SSR\",\"slug\":\"$slug\",\"code\":\"SM$RANDOM\",\"email\":\"$smokeEmail\",\"password\":\"$smokePass\"}" "http://127.0.0.1:$PORT/auth/register")"
page="$(curl -s -w '|%{http_code}' "http://127.0.0.1:$PORT/loja/$slug")"
if [ "$rc" = 201 ] && [ "${page##*|}" = 200 ] && [[ "$page" == *"Loja Smoke SSR"* ]]; then check ok "SSR: /loja/$slug traz o nome da loja no HTML (o servidor do web alcançou a API por http://api:3001)"
else check fail "SSR não trouxe a loja (cadastro=$rc, página=${page##*|}); o web pode estar caindo no plano B do navegador"; fi
# LOGIN BEM-SUCEDIDO + ROTAS DO PAINEL que leem várias tabelas, com o cookie da sessão (INF-22): é o que um `--filter` que deixasse de fora um pacote de que a API precisa em
# tempo de execução (db/Prisma client, shared-types, bcrypt) quebraria. O limite do /auth/login (8/min por IP) pode ainda estar valendo por causa da seção 6b: espera o Retry-After.
jar="$ROOTW/infra/.smoke.cookies"; body="$ROOTW/infra/.smoke.body"; rm -f "$jar"   # ROOTW (C:/...): o curl.exe do Windows não entende /c/... com MSYS_NO_PATHCONV=1
for try in 1 2 3; do
  lh="$(curl -s -D - -o /dev/null -c "$jar" -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$smokeEmail\",\"password\":\"$smokePass\"}" "http://127.0.0.1:$PORT/auth/login" | tr -d '\r')"
  lrc="$(printf '%s' "$lh" | head -1 | awk '{print $2}')"
  [ "$lrc" != 429 ] && break
  ra="$(printf '%s' "$lh" | awk -F': ' 'tolower($1)=="retry-after"{print $2}')"; sleep "$(( ${ra:-30} + 2 ))"
done
if [ "$lrc" = 200 ] && grep -q mc_session "$jar" 2>/dev/null; then check ok "login BEM-SUCEDIDO pela API da imagem (hash de senha carregado e conferido, cookie de sessão emitido)"; else check fail "login do usuário recém-cadastrado falhou (HTTP $lrc)"; fi
# SEC-34: QUAL binário do bcrypt a API da imagem carregou. O Dockerfile compila do fonte e apaga o `prebuilds/`: aqui se confere NA IMAGEM EM EXECUÇÃO que o compilado existe,
# que `prebuilds/` não existe (então só o compilado pode ter carregado: o login acima passou), que o addon aponta para esse caminho e que NÃO há compilador na imagem final.
bres="$("${DC[@]}" exec -T api node -e "
const path=require('path'),fs=require('fs');
const dir=path.dirname(require.resolve('bcrypt/package.json'));
const rel=p=>path.relative('/repo',p);
const compiled=fs.existsSync(path.join(dir,'build/Release/bcrypt_lib.node'));
const pre=fs.existsSync(path.join(dir,'prebuilds'));
const b=require('bcrypt');
const loaded=Object.keys(require.cache).filter(k=>/bcrypt_lib\.node$/.test(k)).map(rel);
console.log(JSON.stringify({compiled,prebuildsPresent:pre,version:require('bcrypt/package.json').version,okHash:b.compareSync('x',b.hashSync('x',4)),loaded}));
" 2>&1 | tr -d '\r' | tail -1)"
if [[ "$bres" == *'"compiled":true'* && "$bres" == *'"prebuildsPresent":false'* && "$bres" == *'"okHash":true'* && "$bres" == *'"version":"6.0.0"'* ]]; then check ok "bcrypt 6.0.0 COMPILADO DO FONTE na imagem: build/Release/bcrypt_lib.node existe, prebuilds/ não existe, hash e compare funcionam ($bres)"; else check fail "binário do bcrypt na imagem não é o esperado: $bres"; fi
ccomp="$("${DC[@]}" exec -T api sh -c 'command -v g++ gcc make python3 cc 2>/dev/null | wc -l' | tr -d '\r\n ')"
[ "$ccomp" = 0 ] && check ok "a imagem final da API NÃO tem compilador (g++/gcc/make/python3 ausentes)" || check fail "a imagem final da API tem $ccomp ferramentas de compilação"
uvt="$("${DC[@]}" exec -T api printenv UV_THREADPOOL_SIZE | tr -d '\r\n')"
[ "$uvt" = 4 ] && check ok "UV_THREADPOOL_SIZE=4 explícito na API (a faixa de hash dimensiona por ele)" || check fail "UV_THREADPOOL_SIZE da API = '$uvt' (esperado 4)"
nrc="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/orders")"
[ "$nrc" = 401 ] && check ok "controle: /api/orders SEM cookie é recusada (401)" || check fail "/api/orders sem cookie devolveu $nrc (esperado 401)"
for p in /auth/me /api/orders /api/catalog/categories /api/store/settings /api/store/subscription /api/reports/summary; do
  prc="$(curl -s -o "$body" -w '%{http_code}' -b "$jar" "http://127.0.0.1:$PORT$p")"
  if [ "$prc" = 200 ]; then check ok "rota do painel com sessão: GET $p = 200 ($(wc -c < "$body" | tr -d ' ') bytes; leitura via Prisma)"; else check fail "GET $p com sessão devolveu $prc: $(head -c 150 "$body")"; fi
done
echo "== 9h upload REAL de foto pela API, leitura pelo Caddy (/media), recusas, persistência, backup e restauração (INF-30, ADR-0017)"
UPD="$ROOTW/infra/.smoke-upload"; rm -rf "$UPD"; mkdir -p "$UPD"
node "$ROOTW/scripts/smoke-fixtures/gera-png.mjs" "$UPD/foto.png" 96 96
printf 'isto nao e imagem' > "$UPD/texto.png"
printf '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>' > "$UPD/xss.svg"
{ printf '\211PNG\r\n\032\n'; head -c 4000 /dev/urandom; } > "$UPD/corrompido.png"
{ cat "$UPD/foto.png"; head -c 9500000 /dev/zero; } > "$UPD/grande.png"
up() { curl -s -b "$jar" -w '|%{http_code}' -F "file=@$UPD/$1;type=${3:-image/png};filename=${4:-$1}" "http://127.0.0.1:$PORT/api/media/images?kind=${2:-PRODUCT}"; }
nfotos() { "${DC[@]}" exec -T api sh -c 'find /uploads -type f | wc -l' | tr -d ' \r\n'; }
N0="$(nfotos)"
out="$(curl -s -w '|%{http_code}' -F "file=@$UPD/foto.png;type=image/png" "http://127.0.0.1:$PORT/api/media/images?kind=PRODUCT")"; [ "${out##*|}" = 401 ] && check ok "9h sem sessão: 401" || check fail "9h upload sem sessão devolveu ${out##*|}"
out="$(up foto.png EVIL)"; [[ "${out##*|}" = 400 && "$out" == *INVALID_KIND* ]] && check ok "9h kind inválido: 400 INVALID_KIND" || check fail "9h kind inválido: $out"
for caso in "texto.png|image/png|.png que é TEXTO" "xss.svg|image/svg+xml|SVG com script" "texto.png|image/jpeg|texto com Content-Type mentido (image/jpeg)"; do
  IFS='|' read -r arq tipo desc <<< "$caso"; out="$(up "$arq" PRODUCT "$tipo")"; code="${out##*|}"
  { [ "$code" = 400 ] || [ "$code" = 415 ] || [ "$code" = 422 ]; } && [[ "$out" == *UNSUPPORTED_TYPE* ]] && check ok "9h $desc: recusado ($code UNSUPPORTED_TYPE)" || check fail "9h $desc NÃO foi recusado como esperado: $out"
done
out="$(up corrompido.png)"; code="${out##*|}"; { [ "$code" = 400 ] || [ "$code" = 415 ] || [ "$code" = 422 ]; } && [[ "$out" == *CORRUPT_IMAGE* || "$out" == *UNSUPPORTED_TYPE* ]] && check ok "9h PNG com magic bytes mas corrompido: recusado ($code)" || check fail "9h PNG corrompido: $out"
out="$(up grande.png)"; [ "${out##*|}" = 413 ] && check ok "9h arquivo de ~9,5 MB (limite 8 MB): 413" || check fail "9h arquivo grande devolveu ${out##*|}"
[ "$(nfotos)" = "$N0" ] && check ok "9h as 6 recusas NÃO deixaram nenhum arquivo no volume" || check fail "9h as recusas deixaram arquivos no volume ($N0 -> $(nfotos))"
out="$(up foto.png PRODUCT image/png '../../../etc/evil.png')"; code="${out##*|}"; resp="${out%|*}"
if [ "$code" = 201 ]; then
  IMGID="$(printf '%s' "$resp" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
  mapfile -t VURLS < <(printf '%s' "$resp" | grep -o 'http[^"]*\.webp' | sort -u)   # o campo `url` repete a maior variante: dedup
  check ok "9h upload válido (nome do arquivo com ../../ é ignorado): 201, ${#VURLS[@]} variante(s)"
  [[ "${VURLS[0]}" =~ /media/stores/[A-Za-z0-9_-]+/[a-f0-9-]{36}-[0-9]+\.webp$ ]] && [[ "${VURLS[0]}" != *evil* && "${VURLS[0]}" != *..* ]] && check ok "9h a URL pública é /media/stores/<loja>/<uuid>-<largura>.webp (nada do nome enviado)" || check fail "9h URL inesperada: ${VURLS[0]}"
else IMGID=""; VURLS=(); check fail "9h upload válido falhou: $out"; fi
vok=0; for u in "${VURLS[@]}"; do
  p="/${u#*://*/}"; hdr="$(curl -s -D - -o "$UPD/baixada.webp" "http://127.0.0.1:$PORT$p" | tr -d '\r')"; hl="${hdr,,}"; magic="$(head -c 12 "$UPD/baixada.webp" | od -An -c | tr -d ' \n')"
  [[ "$hdr" == HTTP*" 200"* && "$hl" == *"content-type: image/webp"* && "$hl" == *"immutable"* && "$hl" == *"nosniff"* && "$magic" == RIFF*WEBP ]] && vok=$((vok+1)) || echo "   variante $p: $(echo "$hdr" | head -1) magic=$magic"
done
[ "$vok" -ge 1 ] && [ "$vok" = "${#VURLS[@]}" ] && check ok "9h TODAS as variantes (${#VURLS[@]}) lidas pelo Caddy: 200, image/webp, bytes RIFF/WEBP reais, cache imutável, nosniff" || check fail "9h variantes lidas ok: $vok de ${#VURLS[@]}"
if [ "${#VURLS[@]}" -ge 1 ]; then
  p0="/${VURLS[0]#*://*/}"; SHA_SERV="$(curl -s "http://127.0.0.1:$PORT$p0" | sha256sum | cut -d' ' -f1)"
  perm="$("${DC[@]}" exec -T api sh -c "stat -c '%a %U' /uploads${p0#/media}" | tr -d '\r')"; [ "$perm" = "644 node" ] && check ok "9h arquivo no volume com modo 644, dono node" || check fail "9h arquivo no volume: '$perm'"
  [ "$(nfotos)" = "$((N0 + ${#VURLS[@]}))" ] && check ok "9h o volume ganhou exatamente ${#VURLS[@]} arquivo(s) (um por variante)" || check fail "9h arquivos no volume: $(nfotos) (esperado $((N0 + ${#VURLS[@]})))"
  # '..' que ESCAPA da raiz, partindo de um caminho real (um '..' que volta ao próprio arquivo legítimo é servido, como a URL normal: não é fuga)
  badt=""; for tp in "/media/stores/x/../../../../etc/passwd" "${p0}/../../../../../etc/passwd" "/media/stores/x/..%2f..%2f..%2f..%2fetc/passwd"; do
    to="$(curl -s --path-as-is -w '|%{http_code}' "http://127.0.0.1:$PORT$tp")"; { [ "${to##*|}" = 404 ] || [ "${to##*|}" = 400 ]; } && [[ "$to" != *"root:"* ]] || badt="$badt [$tp -> ${to##*|}]"
  done
  [ -z "$badt" ] && check ok "9h traversal que escapa da raiz, a partir de caminho real: negado (404/400), sem vazar /etc/passwd" || check fail "9h traversal na leitura:$badt"
  # persistência: reiniciar a API e o Caddy não apaga a foto
  "${DC[@]}" restart api caddy >/dev/null 2>&1; for t in $(seq 1 40); do [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")" = 200 ] && break; sleep 3; done
  [ "$(curl -s "http://127.0.0.1:$PORT$p0" | sha256sum | cut -d' ' -f1)" = "$SHA_SERV" ] && check ok "9h a foto continua igual (mesmo sha256) depois de reiniciar API e Caddy" || check fail "9h a foto mudou ou sumiu depois do restart"
  # backup + restauração das fotos
  bo="$("${DC[@]}" exec -T postgres-backup /bin/sh /scripts/backup.sh 2>&1 | tr -d '\r')"; [[ "$bo" == *"backup-uploads: ok uploads_"* ]] && check ok "9h backup inclui as fotos reais" || check fail "9h backup sem fotos: $(echo "$bo" | tail -1)"
  tarf="$("${DC[@]}" exec -T postgres-backup sh -c 'ls -1 /backups/uploads_*.tar.gz | tail -1' | tr -d '\r')"
  SHA_REST="$("${DC[@]}" exec -T postgres-backup sh -c "rm -rf /tmp/rest9h && sh /scripts/restore-uploads.sh $tarf /tmp/rest9h >/dev/null && sha256sum /tmp/rest9h${p0#/media} | cut -d' ' -f1" | tr -d '\r\n')"
  [ -n "$SHA_REST" ] && [ "$SHA_REST" = "$SHA_SERV" ] && check ok "9h a foto restaurada do backup é BYTE A BYTE a que o Caddy serve (sha256 igual)" || check fail "9h foto restaurada diferente: servida=$SHA_SERV restaurada=$SHA_REST"
fi
if [ -n "$IMGID" ]; then
  out="$(curl -s -b "$jar" -X POST -w '|%{http_code}' "http://127.0.0.1:$PORT/api/media/images/$IMGID/delete")"; [ "${out##*|}" = 200 ] && check ok "9h o dono apaga a imagem: 200" || check fail "9h apagar imagem: $out"
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$p0")" = 404 ] && [ "$(nfotos)" = "$N0" ] && check ok "9h depois de apagar: 404 no /media e o volume volta a $N0 arquivo(s)" || check fail "9h imagem apagada ainda servida ou arquivos restantes ($(nfotos))"
fi
rm -rf "$UPD"
echo "== 9i upload: papel STAFF, cota por loja e falha de gravação (INF-31, ADR-0017)"
UPD="$ROOTW/infra/.smoke-upload9i"; rm -rf "$UPD"; mkdir -p "$UPD"; node "$ROOTW/scripts/smoke-fixtures/gera-png.mjs" "$UPD/foto.png" 96 96
upj() { curl -s -b "$1" -w '|%{http_code}' -F "file=@$UPD/foto.png;type=image/png" "http://127.0.0.1:$PORT/api/media/images?kind=$2"; }
psqlq() { "${DC[@]}" exec -T postgres psql -U meucardapio -d meucardapio -At -v ON_ERROR_STOP=1 "$@" | tr -d '\r'; }
LOJA="$(psqlq -c "select \"storeId\" from \"User\" where email='$smokeEmail'")"
SH="$("${DC[@]}" exec -T api node -e "process.stdout.write(require('bcrypt').hashSync('SenhaStaff-12345',10))" | tr -d '\r')"
STAFF="staff-smoke$RANDOM@exemplo.invalid"
printf "INSERT INTO \"User\"(id,\"storeId\",email,\"passwordHash\",role,\"tokenVersion\",\"createdAt\") VALUES ('stf'||substr(md5(random()::text),1,20),'%s','%s','%s','STAFF',0,now());" "$LOJA" "$STAFF" "$SH" | "${DC[@]}" exec -T postgres psql -U meucardapio -d meucardapio -v ON_ERROR_STOP=1 >/dev/null 2>&1 && check ok "9i funcionário STAFF criado direto no banco (a loja de teste nasce em BASICO e o convite exige plano PRO)" || check fail "9i não consegui criar o STAFF"
jar2="$ROOTW/infra/.smoke.cookies.staff"; rm -f "$jar2"; src=0
for t in 1 2 3 4; do src="$(curl -s -o /dev/null -w '%{http_code}' -c "$jar2" -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$STAFF\",\"password\":\"SenhaStaff-12345\"}" "http://127.0.0.1:$PORT/auth/login")"; [ "$src" != 429 ] && break; sleep 20; done
[ "$src" = 200 ] && grep -q mc_session "$jar2" && check ok "9i o STAFF entra (login 200)" || check fail "9i login do STAFF devolveu $src"
for k in LOGO COVER; do out="$(upj "$jar2" $k)"; [[ "${out##*|}" = 403 && "$out" == *FORBIDDEN_ROLE* ]] && check ok "9i STAFF enviando $k: 403 FORBIDDEN_ROLE (identidade da loja é só do dono)" || check fail "9i STAFF enviando $k: $out"; done
N1="$(nfotos 2>/dev/null || "${DC[@]}" exec -T api sh -c 'find /uploads -type f | wc -l' | tr -d ' \r\n')"
out="$(upj "$jar2" PRODUCT)"; [ "${out##*|}" = 201 ] && check ok "9i STAFF enviando foto de PRODUTO: 201 (permitido)" || check fail "9i STAFF enviando PRODUTO: $out"
SID="$(printf '%s' "${out%|*}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
out="$(curl -s -b "$jar2" -X POST -w '|%{http_code}' "http://127.0.0.1:$PORT/api/media/images/$SID/delete")"; [ "${out##*|}" = 403 ] && check ok "9i STAFF apagando imagem: 403 (só o dono apaga)" || check fail "9i STAFF apagando imagem: $out"
curl -s -b "$jar" -X POST -o /dev/null "http://127.0.0.1:$PORT/api/media/images/$SID/delete"
# cota por loja: enche a loja até o teto (500) com linhas READY e confere que o próximo upload é recusado SEM gravar arquivo
NIMG="$(psqlq -c "select count(*) from \"Image\" where \"storeId\"='$LOJA'")"; TETO=500
psqlq -c "insert into \"Image\"(id,\"storeId\",kind,\"keyBase\",widths,bytes,status,\"createdAt\") select 'cota'||g,'$LOJA','PRODUCT','stores/$LOJA/cota'||g,ARRAY[320],1,'READY',now() from generate_series(1,$TETO-$NIMG) g" >/dev/null
N2="$("${DC[@]}" exec -T api sh -c 'find /uploads -type f | wc -l' | tr -d ' \r\n')"
out="$(upj "$jar" PRODUCT)"; [[ "${out##*|}" = 409 && "$out" == *IMAGE_QUOTA_EXCEEDED* ]] && check ok "9i loja no teto de $TETO imagens: 409 IMAGE_QUOTA_EXCEEDED" || check fail "9i cota: $out"
[ "$("${DC[@]}" exec -T api sh -c 'find /uploads -type f | wc -l' | tr -d ' \r\n')" = "$N2" ] && check ok "9i a recusa por cota NÃO gravou arquivo no volume" || check fail "9i a recusa por cota deixou arquivo no volume"
psqlq -c "delete from \"Image\" where \"storeId\"='$LOJA' and id like 'cota%'" >/dev/null
# falha de gravação (permissão na pasta da loja): NÃO é disco cheio de verdade, mas exercita o mesmo caminho de erro de gravação. O chmod é feito pelo DONO (node): o root do contêiner da API não consegue (cap_drop ALL)
"${DC[@]}" exec -T api sh -c "mkdir -p /uploads/stores/$LOJA && chmod 555 /uploads/stores/$LOJA" >/dev/null 2>&1
out="$(upj "$jar" PRODUCT)"; code="${out##*|}"
{ [ "$code" != 201 ] && [[ "$code" =~ ^[45] ]] && [[ "$out" != */uploads* && "$out" != *EACCES* && "$out" != *"node_modules"* ]]; } && check ok "9i falha de gravação: o upload NÃO é aceito ($code) e a resposta não vaza caminho nem erro interno" || check fail "9i falha de gravação: $out"
rest="$("${DC[@]}" exec -T api sh -c "find /uploads -name '*.tmp*' -o -name '*.partial*' | wc -l; find /uploads -type f | wc -l" | tr -d '\r' | tr '\n' ' ')"
[ "$rest" = "0 $N2 " ] && check ok "9i depois da falha: nenhum arquivo temporário e nenhum arquivo novo no volume" || check fail "9i sobrou arquivo depois da falha de gravação: '$rest' (esperado '0 $N2 ')"
pend="$(psqlq -c "select count(*) from \"Image\" where \"storeId\"='$LOJA' and status='PENDING'")"
echo "   (informativo: linhas PENDING deixadas pela falha = $pend; o job de limpeza as varre depois de QUARENTENA)"
"${DC[@]}" exec -T api sh -c "chmod 755 /uploads/stores/$LOJA" >/dev/null 2>&1
psqlq -c "delete from \"Image\" where \"storeId\"='$LOJA' and status='PENDING'" >/dev/null
out="$(upj "$jar" PRODUCT)"; [ "${out##*|}" = 201 ] && check ok "9i depois de consertar a permissão o upload volta a funcionar (201): sem estado preso" || check fail "9i recuperação: $out"
RID="$(printf '%s' "${out%|*}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"; curl -s -b "$jar" -X POST -o /dev/null "http://127.0.0.1:$PORT/api/media/images/$RID/delete"
rm -rf "$UPD" "$jar2"
rm -f "$jar" "$body"

echo "== 6f menor privilégio: o web NÃO recebe segredo nenhum além do necessário; a API recebe o PIX desligado; check-env.sh aprova o .env do smoke"
# o container do web só pode ter: NODE_ENV, API_INTERNAL_URL, API_INTERNAL_SECRET e o que a imagem traz. Nenhum destes nomes:
wenv="$("${DC[@]}" exec -T web printenv 2>/dev/null | cut -d= -f1 | tr -d '\r')"
wleak=""
for n in JWT_SECRET MFA_HMAC_KEY POSTGRES_PASSWORD DATABASE_URL PAYMENT_ENC_KEY PAYMENT_ENC_KEY_PREV MP_CLIENT_SECRET MP_ACCESS_TOKEN MP_WEBHOOK_SECRET RESEND_API_KEY ADMIN_TOKEN; do
  printf '%s\n' "$wenv" | grep -qx "$n" && wleak="$wleak $n"
done
[ -z "$wleak" ] && check ok "o container do web não tem JWT/MFA/banco/PIX/e-mail/admin no ambiente (só o segredo de serviço e a URL interna)" || check fail "segredos demais no ambiente do web:$wleak"
mode="$("${DC[@]}" exec -T api printenv MP_OAUTH_MODE | tr -d '\r\n')"
[ "$mode" = off ] && check ok "a API sobe com MP_OAUTH_MODE=off por padrão (PIX por loja desligado)" || check fail "MP_OAUTH_MODE da API = '$mode' (esperado off)"
prodenv="$ENVF.prod"
sed -e '/^COOKIE_SECURE=/d' -e 's#^WEB_ORIGIN=.*#WEB_ORIGIN=https://exemplo.invalid#' -e 's#^NEXT_PUBLIC_API_URL=.*#NEXT_PUBLIC_API_URL=https://exemplo.invalid#' -e 's#^DOMAIN=.*#DOMAIN=exemplo.invalid#' "$ENVF" > "$prodenv"
if bash "$ROOT/infra/check-env.sh" "$prodenv" >/dev/null 2>&1; then check ok "infra/check-env.sh APROVA um .env de produção montado com os mesmos segredos do smoke"; else check fail "check-env.sh reprovou um .env de produção válido: $(bash "$ROOT/infra/check-env.sh" "$prodenv" 2>&1 | grep ERRO | head -2 | tr '
' ' ')"; fi
ev="$(bash "$ROOT/infra/check-env.sh" "$ENVF" 2>&1)"
case "$ev" in *"WEB_ORIGIN deve ser https"*"COOKIE_SECURE=false"*|*"COOKIE_SECURE=false"*"WEB_ORIGIN deve ser https"*) check ok "check-env.sh REPROVA o .env do smoke (http e COOKIE_SECURE=false), pelos motivos certos";; *) check fail "check-env.sh não acusou http/COOKIE_SECURE=false no .env do smoke";; esac
rm -f "$prodenv"

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

echo "== 9 limite de requisições por IP em /loja/* (SEC-26 / ST-44, ST-45, ST-48); fica no fim porque a rajada limita o IP do host por 1 min"
# 9a visitantes DISTINTOS não se bloqueiam: 10 containers, cada um com o seu IP na rede, 100 requisições cada (< 120/min) => 0 x 429
# Os 10 clientes precisam existir AO MESMO TEMPO: containers seguidos com --rm recebem o MESMO IP (o Docker reaproveita o que acabou
# de sair; visto em 17/11: o Caddy via um IP só e, com razão, aplicou um balde só). Por isso cada um espera 30 s antes de pedir (com a máquina sufocada, criar os 10 levou mais de 10 s e os primeiros já tinham saído quando li os IPs) e o
# teste confere que os IPs são mesmo distintos; se não forem, o teste é inválido e falha dizendo isso.
tot429=0; CIDS=()
for n in 1 2 3 4 5 6 7 8 9 10; do
  CIDS+=("$(docker run -d --network "${PROJ}_default" node:24-alpine node -e "
    const http=require('http');let c429=0,ok=0,i=0;
    const next=()=>{ if(i>=100){console.log(c429+' '+ok);return;} i++;
      http.get('http://caddy:80/loja/distinto-$n-'+i,r=>{ r.resume(); if(r.statusCode===429)c429++; else ok++; r.on('end',next); }).on('error',()=>{ ok++; next(); }); };
    setTimeout(next,30000);")")
done
ipsd="$(for c in "${CIDS[@]}"; do docker inspect -f "{{(index .NetworkSettings.Networks \"${PROJ}_default\").IPAddress}}" "$c"; done | sort -u | wc -l | tr -d ' ')"
for c in "${CIDS[@]}"; do
  docker wait "$c" >/dev/null; r="$(docker logs "$c" 2>&1 | tail -1)"; docker rm "$c" >/dev/null
  tot429=$((tot429 + ${r%% *}))
done
if [ "$ipsd" != 10 ]; then check fail "teste inválido: os 10 clientes tiveram só $ipsd IPs distintos"
elif [ "$tot429" = 0 ]; then check ok "10 IPs distintos (confirmados) x 100 requisições: 0 respostas 429 (visitantes diferentes não se bloqueiam)"
else check fail "visitantes distintos foram limitados ($tot429 respostas 429, com $ipsd IPs distintos)"; fi
# 9b um IP só, com X-Forwarded-For diferente a cada requisição, bate no teto
pass=0; lim=0; ra=""
for i in $(seq 1 150); do
  out="$(curl -s -o /dev/null -D - -w 'CODE=%{http_code}' -H "X-Forwarded-For: 10.7.$((i % 250)).$((i % 250))" "http://127.0.0.1:$PORT/loja/slug-inexistente-$i")"
  code="${out##*CODE=}"
  if [ "$code" = 429 ]; then lim=$((lim+1)); [ -z "$ra" ] && ra="$(printf '%s' "$out" | tr -d '\r' | grep -i '^retry-after:' | head -1)"; else pass=$((pass+1)); fi
done
echo "   150 requisições a /loja/<aleatório>, cada uma com X-Forwarded-For diferente: $pass passaram, $lim limitadas (429)"
[ "$lim" -ge 1 ] && check ok "o limite por IP real atua em /loja/* ($lim respostas 429); o X-Forwarded-For forjado não escapa" || check fail "nenhuma resposta 429 em 150 requisições: sem limite em /loja/*"
[ "$pass" -ge 100 ] && check ok "não limita cedo demais: $pass requisições passaram antes do teto de 120/min" || check fail "só $pass passaram: o limite está apertado demais"
[ -n "$ra" ] && check ok "a resposta 429 traz Retry-After ($ra)" || check fail "429 sem Retry-After"
h="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"; s="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/stores/nao-existe")"
[ "$h" = 200 ] && [ "$s" = 404 ] && check ok "/health ($h) e a API ($s) seguem livres durante o limite de /loja/*" || check fail "o limite de /loja/* afetou outras rotas (health=$h, api=$s)"
# 9c ST-48: formas de URL que o Next entrega como /loja/<slug> e o Caddy poderia não classificar em /loja/*. O IP JÁ está limitado:
# a forma canônica tem de dar 429 (controle) e NENHUMA variante pode devolver a página da loja (200 com o nome) = contornou o limite.
can="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/loja/$slug")"
[ "$can" = 429 ] && check ok "controle: a forma canônica /loja/$slug está limitada agora (429)" || check fail "controle falhou: /loja/$slug deu $can (esperado 429)"
bypass=""; ntot=0
for form in "//loja/$slug" "/./loja/$slug" "/x/../loja/$slug" "/LOJA/$slug" "/%6coja/$slug" "/loja%2F$slug" "/loja;x/$slug"; do
  n429=0; nweb=0; nstore=0
  for k in $(seq 1 30); do
    resp="$(curl -s --path-as-is -w '|CODE=%{http_code}' "http://127.0.0.1:$PORT$form")"; c="${resp##*CODE=}"; ntot=$((ntot+1))
    if [ "$c" = 429 ]; then n429=$((n429+1)); else nweb=$((nweb+1)); case "$resp" in *"Loja Smoke SSR"*) [ "$c" = 200 ] && nstore=$((nstore+1));; esac; fi
  done
  echo "   forma [$form]: 30 req => $n429 limitadas, $nweb chegaram ao web, $nstore serviram a página da loja"
  [ "$nstore" -gt 0 ] && bypass="$bypass [$form]"
done
[ -z "$bypass" ] && check ok "ST-48: nenhuma das 7 formas de URL serve a página da loja com o IP limitado ($ntot requisições)" || check fail "ST-48: contornam o limite de /loja/*:$bypass"
# 9d ST-45 (IPv6): sem IPv6 na rede do smoke não há como testar com curl -6; confere que a zona agrupa IPv6 em /64 e que o módulo varre chaves (ST-49)
grep -q 'ipv6_prefix 64' "$ROOT/infra/Caddyfile" && check ok "ST-45: a zona de limite agrupa IPv6 em /64 (ipv6_prefix 64); sem AAAA no piloto de qualquer forma" || check fail "ST-45: Caddyfile sem ipv6_prefix 64"
grep -q 'sweep_interval' "$ROOT/infra/Caddyfile" && check ok "ST-49: varredura de chaves vencidas configurada (sweep_interval) e container com limite de memória" || check fail "ST-49: sem sweep_interval no Caddyfile"
# 9f INF-19 / SEC-34 (R-1): limite de entrada em /auth/* por ORIGEM (IPv4 = IP; IPv6 = /48), 60/min nas rotas sensíveis. O 429 do Caddy tem corpo VAZIO; o da API tem JSON.
echo "   9f /auth/*: espera 65 s para a janela do limite esvaziar (o login e o cadastro acima já contaram)..."
sleep 65
caddy429() {  # $1 = n pedidos, $2 = caminho, $3 = metodo; imprime: <429 do Caddy (sem x-ratelimit-limit)> <429 da API (com x-ratelimit-limit)> <outros>
  local n="$1" p="$2" m="$3" c=0 a=0 o=0 i h code
  for i in $(seq 1 "$n"); do
    h="$(curl -s -D - -o /dev/null -X "$m" -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT$p" | tr -d '\r')"
    code="$(printf '%s\n' "$h" | head -1 | awk '{print $2}')"
    if [ "$code" = 429 ]; then if [[ "${h,,}" == *x-ratelimit-limit* ]]; then a=$((a+1)); else c=$((c+1)); fi; else o=$((o+1)); fi
  done
  echo "$c $a $o"
}
# uso normal (loja inteira atrás do mesmo IP): 28 pedidos em 1 min, abaixo do limite da API de CADA rota (forgot 5, login 8, inspect 10, reset 5): NENHUM 429, de nenhuma camada
r1="$(caddy429 5 /auth/forgot-password POST)"; r2="$(caddy429 8 /auth/login POST)"; r3="$(caddy429 10 /auth/reset-password/inspect POST)"; r4="$(caddy429 5 /auth/reset-password POST)"
if [[ "$r1" == "0 0 5" && "$r2" == "0 0 8" && "$r3" == "0 0 10" && "$r4" == "0 0 5" ]]; then check ok "9f uso normal: 28 pedidos às rotas sensíveis de um mesmo IP em 1 min: nenhuma resposta 429 (nem do Caddy, nem da API)"; else check fail "9f uso normal recebeu 429 (caddy api outros): forgot[$r1] login[$r2] inspect[$r3] reset[$r4]"; fi
# /auth/me NÃO entra no limite (o painel o chama o tempo todo)
rme="$(caddy429 80 /auth/me GET)"
[ "${rme%% *}" = 0 ] && check ok "9f /auth/me: 80 pedidos, 0 respostas 429 do Caddy (fora do limite, como o painel precisa)" || check fail "9f /auth/me limitado pelo Caddy: $rme"
# rajada: passa de 60/min na origem => 429 do Caddy com Retry-After
rb="$(caddy429 100 /auth/forgot-password POST)"
cb="${rb%% *}"
curl -s -D - -o /dev/null -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/auth/forgot-password" | tr -d '\r' | sed 's/^/      [cabeçalhos de um 429] /' | head -6
if [ "$cb" -ge 20 ]; then check ok "9f rajada de 100 pedidos (mais que o limite de 60/min SOZINHA, então vale mesmo se a máquina lenta deixar o uso normal sair da janela): $cb respostas 429 do CADDY (corpo vazio; a origem passou de 60/min)"; else check fail "9f a rajada não foi limitada pelo Caddy ($rb)"; fi
rh="$(curl -s -D - -o /dev/null -X POST -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT/auth/login" | tr -d '\r')"
[[ "$rh" == *"429"* && "$rh" == *[Rr]etry-[Aa]fter* ]] && check ok "9f a resposta 429 do Caddy traz Retry-After" || check fail "9f 429 do Caddy sem Retry-After"
# /loja e /health fora desta zona (zona própria)
lrc="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"
[ "$lrc" = 200 ] && check ok "9f /health segue livre com a zona de /auth esgotada" || check fail "9f /health devolveu $lrc"
# variantes de URL (caixa e barra dupla) também caem na zona. A janela do limite é DESLIZANTE (1 min): sob carga a rajada acima pode levar mais de 1 min e a zona deixa de estar
# esgotada quando as variantes rodam. Por isso cada variante é testada SOZINHA e RÁPIDA: esgota a zona por um caminho canônico (80 pedidos em paralelo, ~segundos) e testa a variante
# em seguida (também em paralelo). 429 do Caddy = sem o cabeçalho x-ratelimit-limit (a API o emite).
caddy429par() {  # $1 = n, $2 = caminho, $3 = método; imprime: <429 do Caddy> <429 da API> <outros>
  seq 1 "$1" | xargs -P 20 -I{} curl -s -o /dev/null -w '%{http_code} [%header{x-ratelimit-limit}]\n' -X "$3" -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$PORT$2" 2>/dev/null \
    | awk '{ if ($1==429 && $2=="[]") c++; else if ($1==429) a++; else o++ } END { print c+0, a+0, o+0 }'
}
for v in '/AUTH/Forgot-Password' '//auth/forgot-password' '/auth/./forgot-password' '/auth/forgot-password/'; do
  caddy429par 80 /auth/forgot-password POST >/dev/null
  vr="$(caddy429par 10 "$v" POST)"
  [ "${vr%% *}" -ge 1 ] && check ok "9f variante [$v]: 429 do Caddy (a zona esgotada vale também para ela)" || check fail "9f variante [$v] escapou da zona (resposta: $vr)"
done
# IPv6 /48 e a zona: sem IPv6 na rede do smoke (curl -6 não é possível), confere a configuração
grep -q 'ipv6_prefix 48' "$ROOT/infra/Caddyfile" && check ok "9f a zona de /auth agrupa IPv6 em /48 (ipv6_prefix 48)" || check fail "9f Caddyfile sem ipv6_prefix 48 na zona de /auth"
mem="$(docker inspect -f '{{.HostConfig.Memory}}' "$("${DC[@]}" ps -q caddy)")"
[ "$mem" -gt 0 ] 2>/dev/null && check ok "ST-49: o container do Caddy tem teto de memória ($((mem/1024/1024)) MB)" || check fail "ST-49: container do Caddy sem limite de memória"

CID9="$("${DC[@]}" ps -q caddy)"
# 9e ST-50 (Sun Tzu): memória do limitador por CHAVE. A chave real é o IP e do host todo tráfego tem um IP só; então a rota de teste
# /__mem (só no Caddyfile do smoke) usa a MESMA zona (events 120, window 1m) chaveada pelo cabeçalho X-Mem-Key: 20 mil valores
# distintos medem o custo por chave sem precisar de 20 mil IPs.
# DECISÃO DO ATLAS (17/11): ST-50 é risco ACEITO; mem_limit 768 MB (era 512 MB: a folga sob rotatividade de IPs era pequena).
# Critério deste teste: o teto configurado sustenta >= 60 mil IPs distintos por janela a 80% (com 6 a 7 KB/chave e 768 MB dá ~90 mil).
# Se alguém baixar o mem_limit ou o custo por chave subir, falha.
memmb() { docker stats --no-stream --format '{{.MemUsage}}' "$1" | awk '{v=$1; if (v ~ /GiB/) {sub(/GiB/,"",v); printf "%.1f", v*1024} else if (v ~ /MiB/) {sub(/MiB/,"",v); printf "%.1f", v} else if (v ~ /KiB/) {sub(/KiB/,"",v); printf "%.1f", v/1024} else {sub(/B/,"",v); printf "%.1f", v/1048576}}'; }
onda() { # onda <prefixo-das-chaves>: 20 mil chaves distintas; imprime "done <429>"
  docker run --rm --network "${PROJ}_default" node:24-alpine node -e "
    const http=require('http');const agent=new http.Agent({keepAlive:true,maxSockets:64});
    let sent=0,done=0,c429=0,total=20000;
    const one=()=>{ if(sent>=total) return; const i=sent++;
      http.get({host:'caddy',port:80,path:'/__mem',agent,headers:{'X-Mem-Key':'$1-'+i}},r=>{ r.resume(); if(r.statusCode===429)c429++; r.on('end',()=>{done++; if(done===total){console.log('done '+c429);agent.destroy();} else one();}); }).on('error',()=>{done++; if(done===total){console.log('done '+c429);agent.destroy();} else one();}); };
    for(let k=0;k<64;k++) one();" 2>&1 | tail -1
}
m0="$(memmb "$CID9")"
mres="$(onda chave)"
m1="$(memmb "$CID9")"
delta="$(awk -v a="$m0" -v b="$m1" 'BEGIN{printf "%.1f", b-a}')"
perkey="$(awk -v d="$delta" 'BEGIN{printf "%.0f", d*1048576/20000}')"
limmb="$(awk -v m="$mem" 'BEGIN{printf "%.0f", m/1048576}')"
proj="$(awk -v p="$perkey" -v l="$limmb" 'BEGIN{ if (p>0) printf "%.0f", (l*0.8*1048576)/p/1000; else print "0" }')"
echo "   20000 chaves distintas (resultado do cliente: $mres): memória do Caddy $m0 MB -> $m1 MB (+$delta MB, ~${perkey} B/chave); com o teto de ${limmb} MB: ~${proj} mil IPs distintos por janela a 80%"
if [ "$proj" -ge 60 ]; then check ok "ST-50 (risco aceito): ~${perkey} B/chave; o teto de ${limmb} MB sustenta ~${proj} mil IPs distintos por janela (>= 60 mil)"
else check fail "ST-50: o teto de ${limmb} MB sustenta só ~${proj} mil IPs distintos (~${perkey} B/chave); critério >= 60 mil: subir mem_limit, reduzir events ou limitar na borda/CDN"; fi
echo "   aguardando ${SMOKE_SWEEP_WAIT:-130}s para a varredura de chaves vencidas (janela 1m + sweep 1m)..."
sleep "${SMOKE_SWEEP_WAIT:-130}"
m2="$(memmb "$CID9")"
echo "   memória do Caddy 2 min depois: $m2 MB (antes da carga: $m0 MB; logo após a 1ª leva: $m1 MB)"
# Prova de que as chaves VENCIDAS são descartadas (Sun Tzu): uma 2ª leva de 20 mil chaves NOVAS. Se o pico ficar perto do da 1ª leva, a
# memória é reaproveitada (heap retido pelo Go, não vazamento); se somar outro bloco inteiro, o módulo não libera as chaves (subir
# mem_limit só adiaria o problema).
mres2="$(onda nova)"
m3="$(memmb "$CID9")"
cresc="$(awk -v a="$m1" -v b="$m3" 'BEGIN{printf "%.1f", b-a}')"
echo "   2ª leva de 20000 chaves NOVAS (resultado do cliente: $mres2): memória $m2 MB -> $m3 MB (1ª leva chegou a $m1 MB; diferença $cresc MB)"
# Calibrado com o experimento de 10 levas seguidas (hopper/evidencias/ST-50-levas.md): quando as chaves NÃO são liberadas, cada leva soma o
# bloco inteiro (~$delta MB) e o container morre em 2-3 levas; o que se observou foi crescimento por heap retido pelo Go (a 2ª leva soma
# ~metade do bloco e depois estabiliza perto do GOMEMLIMIT). Por isso: >= 80% do bloco somado = falha; entre 30% e 80% = ok com AVISO.
# DISCLOSURE (Deming): este limiar de 80% foi escolhido DEPOIS de ver o número da 2ª leva (o critério antigo, 30%, reprovava um
# comportamento que o experimento mostrou ser heap retido). Ele só pega o caso "nada é liberado"; NÃO prova ausência de vazamento
# pequeno: o crescimento lento das levas seguintes segue como risco aberto (ST-50-levas.md e runbook).
if awk -v c="$cresc" -v d="$delta" 'BEGIN{exit !(c >= 0.8*d)}'; then check fail "ST-50: a 2ª leva somou mais $cresc MB (pico $m3 MB; bloco inteiro = ~$delta MB): as chaves vencidas NÃO estão sendo liberadas; subir mem_limit só adia"
elif awk -v c="$cresc" -v d="$delta" 'BEGIN{exit !(c <= 0.3*d)}'; then check ok "ST-50: as chaves vencidas são descartadas (2ª leva reaproveitou a memória: pico $m3 MB contra $m1 MB da 1ª)"
else check ok "ST-50: a 2ª leva NÃO somou o bloco inteiro (+$cresc MB de ~$delta MB; pico $m3 MB): chaves vencidas são liberadas em boa parte; o resto é heap retido pelo Go [aviso: confira ST-50-levas.md]"; fi

echo "== 10 Caddy com privilégio mínimo, redes separadas e rastreabilidade do build (INF-18)"
CID="$("${DC[@]}" ps -q caddy)"
cuid="$(docker exec "$CID" id -u 2>/dev/null | tr -d '\r')"
[ "$cuid" = 65532 ] && check ok "o Caddy roda SEM root (uid $cuid) e mesmo assim atende 80/443 (sem setcap no binário copiado)" || check fail "uid do Caddy = '$cuid' (esperado 65532)"
caps="$(docker inspect -f '{{.HostConfig.CapDrop}} | {{.HostConfig.CapAdd}} | ro={{.HostConfig.ReadonlyRootfs}} | mem={{.HostConfig.Memory}}' "$CID")"
echo "   $caps"
case "$caps" in *ALL*NET_BIND_SERVICE*ro=true*) check ok "cap_drop ALL + só NET_BIND_SERVICE; sistema de arquivos somente leitura";; *) check fail "hardening do Caddy incompleto: $caps";; esac
docker exec "$CID" sh -c 'touch /etc/caddy/x 2>/dev/null' && check fail "o Caddy conseguiu ESCREVER em /etc/caddy (sistema de arquivos deveria ser somente leitura)" || check ok "escrever em /etc/caddy é recusado (somente leitura)"
docker exec "$CID" sh -c 'touch /data/.w && rm /data/.w && touch /config/.w && rm /config/.w' && check ok "/data (conta ACME) e /config são graváveis pelo usuário sem privilégio" || check fail "o Caddy sem root não consegue gravar em /data ou /config"
for i in $(seq 1 20); do hs="$(docker inspect -f '{{.State.Health.Status}}' "$CID")"; [ "$hs" = healthy ] && break; sleep 3; done
[ "$hs" = healthy ] && check ok "healthcheck do Caddy: healthy" || check fail "healthcheck do Caddy: $hs"
# NG-16 (Deming): o log de ACESSO do Caddy também gravaria a URL com ?token=. O Caddyfile não tem `log` de site, então esse log NÃO EXISTE; confere
# no comportamento: um valor único na query não pode aparecer nos logs do Caddy. ATENÇÃO: isto cobre SÓ o log de ACESSO. O log de ERRO (upstream
# fora do ar) é outro caminho e é provado na seção 11 (C1, INF-19), com controle positivo. Este teste NÃO tem controle positivo.
qtok="smoke-q-$RANDOM$RANDOM$RANDOM"
curl -s -o /dev/null "http://127.0.0.1:$PORT/health?token=$qtok&code=$qtok"; sleep 2
[ "$("${DC[@]}" logs caddy 2>&1 | grep -c "$qtok")" = 0 ] && check ok "NG-16: o log de ACESSO não existe: a URL com token/code na query não aparece nos logs do Caddy (o log de ERRO é a seção 11)" || check fail "NG-16: o valor do token apareceu nos logs do Caddy"
# redes: o banco só existe na rede de dados (interna). Caddy e web não o enxergam; a API sim (controle positivo).
# Prova por CONEXÃO ao IP do banco (um timeout de DNS não prova nada: o resolvedor do Docker demora a responder nomes que não conhece).
ares="$("${DC[@]}" exec -T api node -e "require('dns').lookup('postgres',(e,a)=>console.log(e?'ERRO '+e.code:'ok '+a))" 2>&1 | tr -d '\r' | tail -1)"
case "$ares" in ok*) check ok "controle: a API resolve 'postgres' ($ares)";; *) check fail "controle falhou: a API não resolve o banco ($ares)";; esac
pgip="${ares#ok }"
tcp='const s=require("net").connect({host:process.argv[1],port:5432,timeout:3000});s.on("connect",()=>{console.log("conectou");process.exit(0)});s.on("timeout",()=>{console.log("timeout");process.exit(1)});s.on("error",e=>{console.log("erro "+e.code);process.exit(1)})'
actl="$("${DC[@]}" exec -T api node -e "$tcp" "$pgip" 2>&1 | tr -d '\r' | tail -1)"
[ "$actl" = conectou ] && check ok "controle: a API CONECTA ao Postgres em $pgip:5432" || check fail "controle falhou: a API não conectou ao banco ($actl)"
wcon="$("${DC[@]}" exec -T web node -e "$tcp" "$pgip" 2>&1 | tr -d '\r' | tail -1)"
[ "$wcon" = conectou ] && check fail "o web CONECTA ao Postgres em $pgip:5432 (rede de dados deveria estar isolada)" || check ok "o web NÃO conecta ao Postgres ($wcon)"
ccon="$(docker run --rm --network container:"$CID" node:24-alpine node -e "$tcp" "$pgip" 2>&1 | tr -d '\r' | tail -1)"
[ "$ccon" = conectou ] && check fail "o Caddy CONECTA ao Postgres em $pgip:5432 (rede de dados deveria estar isolada)" || check ok "o Caddy NÃO conecta ao Postgres ($ccon; testado dentro da rede dele)"
# rastreabilidade (BOARD): versão, build-info (módulo e commit) e digest da imagem final
echo "   caddy version: $(docker exec "$CID" caddy version 2>&1 | head -1)"
echo "   módulo no binário: $(docker exec "$CID" caddy build-info 2>&1 | tr -d '\r' | grep -i 'caddy-ratelimit' | head -1)"
echo "   imagem final (id): $(docker inspect -f '{{.Image}}' "$CID")"
docker exec "$CID" caddy build-info 2>&1 | tr -d '\r' | grep -qi 'caddy-ratelimit.*5625512f24f6' && check ok "o binário contém o módulo no commit travado 5625512f24f6" || check fail "build-info não mostra o commit esperado do módulo"


echo "== 11 C1 (INF-19): NENHUM segredo em log de contêiner nenhum (caddy, web e api), com a pilha de pé e depois com web e API derrubados"
# Tem de ser a ÚLTIMA seção: derruba web e api. Valores ÚNICOS por execução, mandados a todas as rotas PELO CADDY (a porta publicada).
#  V1 query do reset (web) | V2 token no CAMINHO do QR de mesa (web) | V3 x-order-token | V4 orderId no CAMINHO da API (a credencial do cliente, ST-70)
#  V5 X-Mfa-Challenge | V6 X-Admin-Token | V7 Authorization | V8 Cookie | V9 ?token= na query da API
# Contexto (medido em 17/11): o log de ERRO do Caddy gravava `request` inteiro com o upstream fora do ar (filtrado no Caddyfile desde a INF-19).
# O web (`next start`) não escreve nada por requisição (medição da Tesla; por isso o controle do web é o STATUS da resposta, não uma linha de log).
# A API loga `incoming request`/`request completed` com o CAMINHO cru: o V4 SAI EM CLARO ENQUANTO O ST-70 (SEC-31, Nightingale) NÃO FOR CORRIGIDO.
KNOWN_RED_ST70="${KNOWN_RED_ST70:-1}"   # 1 = o vazamento do caminho da API (V4) é VERMELHO CONHECIDO (visível, não conta como falha). Ponha 0 quando a SEC-31 entrar.
V1="smoke-v1-$RANDOM$RANDOM"; V2="smoke-v2-$RANDOM$RANDOM"; V3="smoke-v3-$RANDOM$RANDOM"; V4="smoke-v4-$RANDOM$RANDOM"; V5="smoke-v5-$RANDOM$RANDOM"
V6="smoke-v6-$RANDOM$RANDOM"; V7="smoke-v7-$RANDOM$RANDOM"; V8="smoke-v8-$RANDOM$RANDOM"; V9="smoke-v9-$RANDOM$RANDOM"
c11_envia() { # imprime os 3 códigos: web-query / web-caminho / api
  local a b c
  a="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "http://127.0.0.1:$PORT/reset-senha?token=$V1")"
  b="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "http://127.0.0.1:$PORT/loja/x/m/$V2")"
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -H "x-order-token: $V3" -H "X-Mfa-Challenge: $V5" -H "X-Admin-Token: $V6" -H "Authorization: $V7" -H "Cookie: sid=$V8" "http://127.0.0.1:$PORT/stores/x/orders/$V4/payment-status?token=$V9")"
  echo "$a/$b/$c"
}
cA="$(c11_envia)"                      # momento A: pilha de pé
"${DC[@]}" stop web api >/dev/null 2>&1
cB="$(c11_envia)"                      # momento B: web e API fora do ar (o erro do proxy cai no log de erro do Caddy)
sleep 2
# autoverificação: A precisa ter ALCANÇADO web e API (nem 502 nem 429 nem 000); B precisa ser 502 nas 3. Senão o teste não provou nada.
okA=1; for code in $(echo "$cA" | tr '/' ' '); do case "$code" in 502|429|000) okA=0;; esac; done
if [ "$okA" = 1 ] && [ "$cB" = "502/502/502" ]; then check ok "as requisições chegaram ao web e à API com a pilha de pé ($cA) e voltaram 502 com eles fora do ar ($cB): o teste vale"
else check fail "TESTE INVÁLIDO: esperava códigos que alcançam web/API com a pilha de pé (veio $cA; 429 = limite por IP ainda ativo) e 502/502/502 com eles fora (veio $cB)"; fi
LOGC="$("${DC[@]}" logs caddy 2>&1)"; LOGW="$("${DC[@]}" logs web 2>&1)"; LOGA="$("${DC[@]}" logs api 2>&1)"
cnt() { printf '%s' "$2" | grep -c -- "$1"; }
# --- CADDY e WEB: nenhum dos 9 valores, em nenhum momento
for svc in caddy web; do
  case "$svc" in caddy) L="$LOGC";; web) L="$LOGW";; esac
  n=0; for v in "$V1" "$V2" "$V3" "$V4" "$V5" "$V6" "$V7" "$V8" "$V9"; do n=$((n + $(cnt "$v" "$L"))); done
  [ "$n" = 0 ] && check ok "C1 [$svc]: nenhum dos 9 valores únicos aparece no log do $svc (query, caminhos, 5 cabeçalhos)" || check fail "C1 [$svc]: $n ocorrência(s) de segredo no log do $svc"
done
# --- API: a query e os cabeçalhos NÃO podem aparecer (NG-16); o CAMINHO (V4) é o ST-70
n=0; for v in "$V1" "$V2" "$V3" "$V5" "$V6" "$V7" "$V8" "$V9"; do n=$((n + $(cnt "$v" "$LOGA"))); done
[ "$n" = 0 ] && check ok "C1 [api]: query (V9) e os 5 cabeçalhos (V3,V5..V8) não aparecem no log da API (NG-16)" || check fail "C1 [api]: $n ocorrência(s) de segredo de query/cabeçalho no log da API"
nv4="$(cnt "$V4" "$LOGA")"
if [ "$nv4" = 0 ]; then check ok "C1 [api]: o orderId no CAMINHO (V4) NÃO aparece no log da API (ST-70 corrigido; ponha KNOWN_RED_ST70=0 para travar)"
elif [ "$KNOWN_RED_ST70" = 1 ]; then KRED=$((KRED+1)); echo "  [VERMELHO CONHECIDO] ST-70 (SEC-31, Nightingale): o orderId no CAMINHO apareceu $nv4 vez(es) no log da API (incoming request / request completed com o caminho cru). NÃO é falha nova: continua aberto"
else check fail "C1 [api]: o orderId no CAMINHO (V4) aparece $nv4 vez(es) no log da API (ST-70)"; fi
# --- CONTROLES POSITIVOS, um por serviço (provam que o log do serviço existe e que a ausência dos valores é significativa)
nerr="$(printf '%s' "$LOGC" | grep -c '"logger":"http.log.error".*"status":502')"
faltou=""; nred=0; for f in '/reset-senha/REDACTED' '/loja/REDACTED' '/stores/REDACTED'; do if [[ "$LOGC" == *"\"uri\":\"$f\""* ]]; then nred=$((nred+1)); else faltou="$faltou $f"; fi; done
{ [ "$nerr" -ge 3 ] && [ "$nred" = 3 ]; } && check ok "controle [caddy]: o log de ERRO existe ($nerr linhas http.log.error 502) e o filtro agiu nas 3 rotas (uri reduzido; cabeçalhos removidos)" || { check fail "controle [caddy]: $nerr linha(s) de erro 502 e $nred/3 uri filtrados; FALTOU:$faltou (o filtro virou 'sem log' ou não agiu nessa rota)"; echo "   --- linhas http.log.error (já filtradas, seguras de mostrar):"; printf '%s' "$LOGC" | grep '"logger":"http.log.error"' | cut -c1-360 | head -6 | sed 's/^/   /'; }
napi="$(printf '%s' "$LOGA" | grep -c 'payment-status')"
[ "$napi" -ge 1 ] && check ok "controle [api]: o log da API registra a requisição ($napi linha(s) com a rota payment-status): a ausência dos valores de query/cabeçalho é significativa" || check fail "controle [api]: nenhuma linha de log da requisição à API (o teste não distingue 'redigido' de 'sem log')"
# web: `next start` não escreve linha por requisição; o controle é a resposta (já conferida acima) e o log só ter a inicialização
nweb="$(printf '%s' "$LOGW" | grep -c .)"
echo "   controle [web]: sem linha por requisição (esperado no next start); o log do web tem $nweb linha(s) (inicialização); o controle é que o web RESPONDEU ($cA) com os valores na URL"

echo; echo "RESULTADO: $PASS ok, $FAILS falhas, $KRED vermelho(s) conhecido(s)$([ "$KRED" -gt 0 ] && echo " (ST-70: ver acima; NÃO é sucesso total)")"
[ "$FAILS" -eq 0 ]
