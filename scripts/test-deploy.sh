#!/bin/bash
# Teste do infra/deploy.sh (INF-19). Roda com docker e curl FALSOS no PATH: não toca em Docker real, não precisa de rede, < 10 s.
# Prova o que o Atlas pediu: se a pilha não ficar saudável em N segundos o deploy FALHA e mostra o estado e o log da API (a guarda de fuso do
# SEC-32 gera crash loop e `docker compose up -d` sozinho NÃO falharia). Os "segredos" abaixo são fictícios e descartáveis.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; INFRA="$HERE/../infra"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/infra" "$TMP/bin"
cp "$INFRA/deploy.sh" "$INFRA/check-env.sh" "$TMP/infra/"; chmod +x "$TMP/infra/deploy.sh" "$TMP/infra/check-env.sh"
PASS=0; FAILS=0
S1="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"; S2="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2"; S3="cccccccccccccccccccccccccccccccccccccccc3"; PG="ffffffffffffffffffffffffffffffff"

cat > "$TMP/bin/docker" <<'EOF'
#!/bin/bash
echo "docker $*" >> "$STUB_LOG"
case "$*" in
  *"config -q"*) exit 0 ;;
  *"ps --status running --services"*) exit 0 ;;
  *" build"*) exit 0 ;;
  *" up "*) if [ "${STUB_UP:-ok}" = ok ]; then exit 0; else echo "container infra-api-1 is unhealthy" >&2; exit 1; fi ;;
  *" ps -q api"*) echo "cid-api"; exit 0 ;;
  *" ps -a"*|*" ps") echo "SERVICO ESTADO: api restarting"; exit 0 ;;
  *" logs "*) echo "api-1  | FATAL: timezone do banco = America/Sao_Paulo (esperado UTC)"; exit 0 ;;
  "inspect -f {{.RestartCount}} cid-api") echo "${STUB_RESTARTS:-0}"; exit 0 ;;
  "image inspect "*) exit 0 ;;
esac
exit 0
EOF
printf '#!/bin/bash\necho "curl $*" >> "$STUB_LOG"\nexit ${STUB_CURL:-0}\n' > "$TMP/bin/curl"
chmod +x "$TMP/bin/docker" "$TMP/bin/curl"

envok() { cat > "$TMP/infra/.env" <<EOF
POSTGRES_PASSWORD=$PG
JWT_SECRET=$S1
MFA_HMAC_KEY=$S2
API_INTERNAL_SECRET=$S3
DOMAIN=pedidos.exemplo.invalid
ACME_EMAIL=ops@exemplo.invalid
APP_VERSION=abc1234
MFA_ENFORCED=true
RESEND_API_KEY=re_chave_ficticia_para_o_teste
STORAGE_S3_ENDPOINT=https://s3.exemplo.invalid
STORAGE_S3_BUCKET=cardapio-media
STORAGE_S3_ACCESS_KEY_ID=AKIAFICTICIA
STORAGE_S3_SECRET_ACCESS_KEY=chave-secreta-ficticia-do-teste
STORAGE_PUBLIC_BASE_URL=https://cdn.exemplo.invalid/cardapio-media
WEB_ORIGIN=https://pedidos.exemplo.invalid
NEXT_PUBLIC_API_URL=https://pedidos.exemplo.invalid
EOF
}
# roda: <STUB_UP> <STUB_RESTARTS> <STUB_CURL> <argumentos do deploy.sh...>; saída em $OUT, código em $RC, chamadas ao docker em $LOG
roda() { local up="$1" rs="$2" cu="$3"; shift 3; : > "$TMP/calls.log"
  # `env` e não prefixo: uma expansão ${X:+A=b} na frente do comando é lida como NOME de comando, não como atribuição de variável.
  OUT="$(cd "$TMP/infra" && env PATH="$TMP/bin:$PATH" STUB_LOG="$TMP/calls.log" STUB_UP="$up" STUB_RESTARTS="$rs" STUB_CURL="$cu" ${WAIT_ENV:+DEPLOY_WAIT=$WAIT_ENV} ./deploy.sh "$@" 2>&1)"; RC=$?; LOG="$(cat "$TMP/calls.log")"; }
caso() { local desc="$1" cond="$2"; if eval "$cond"; then PASS=$((PASS+1)); echo "  [ok]    $desc"; else FAILS=$((FAILS+1)); echo "  [FALHA] $desc"; echo "$OUT" | sed 's/^/          /' | head -14; fi; }
semsegredo() { for s in "$S1" "$S2" "$S3" "$PG"; do [[ "$OUT" == *"$s"* ]] && return 1; done; return 0; }

echo "== --check"
envok; roda ok 0 0 --check
caso "--check com .env válido sai 0 e NÃO chama o docker" '[ "$RC" = 0 ] && [ -z "$LOG" ]'
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=curto/" "$TMP/infra/.env"; roda ok 0 0 --check
caso "--check com segredo curto sai != 0, nada de docker e não imprime os outros valores" '[ "$RC" != 0 ] && [ -z "$LOG" ] && semsegredo'
# INF-19/C2: o deploy de produção usa check-env --prod: sem MFA_ENFORCED=true ou sem RESEND_API_KEY ele ABORTA antes de tocar no docker
envok; sed -i "/^MFA_ENFORCED=/d" "$TMP/infra/.env"; roda ok 0 0
caso "deploy sem MFA_ENFORCED=true ABORTA (exit 1), sem chamar o docker" '[ "$RC" = 1 ] && [ -z "$LOG" ] && [[ "$OUT" == *"MFA_ENFORCED não é true"* ]] && [[ "$OUT" == *"ABORTADO"* ]]'
envok; sed -i "s/^RESEND_API_KEY=.*/RESEND_API_KEY=/" "$TMP/infra/.env"; roda ok 0 0
caso "deploy com RESEND_API_KEY vazia ABORTA (exit 1), sem chamar o docker" '[ "$RC" = 1 ] && [ -z "$LOG" ] && [[ "$OUT" == *"RESEND_API_KEY vazia"* ]]'
envok; sed -i "s/^APP_VERSION=.*/APP_VERSION=local/" "$TMP/infra/.env"; roda ok 0 0
caso "deploy com APP_VERSION=local ABORTA (exit 1), sem chamar o docker" '[ "$RC" = 1 ] && [ -z "$LOG" ] && [[ "$OUT" == *"APP_VERSION=local"* ]]'
echo "== deploy normal"
envok; roda ok 0 0
caso "deploy saudável sai 0 e diz 'Deploy concluído'" '[ "$RC" = 0 ] && [[ "$OUT" == *"Deploy concluído"* ]]'
caso "o up usa --wait com o tempo padrão de 180 s" '[[ "$LOG" == *"up -d --remove-orphans --wait --wait-timeout 180"* ]]'
caso "o build roda ANTES do up" 'b="$(grep -n " build" "$TMP/calls.log" | head -1 | cut -d: -f1)"; u="$(grep -n " up " "$TMP/calls.log" | head -1 | cut -d: -f1)"; [ -n "$b" ] && [ -n "$u" ] && [ "$b" -lt "$u" ]'
caso "a saída não contém nenhum valor de segredo" 'semsegredo'
echo "== a pilha NÃO fica saudável (crash loop da guarda de fuso): o deploy tem de FALHAR e mostrar o log da API"
envok; roda fail 0 0
caso "falha da espera: sai 1" '[ "$RC" = 1 ]'
caso "mostra 'FALHOU', o estado dos serviços e a linha de erro da API" '[[ "$OUT" == *"FALHOU: a pilha não ficou saudável em 180s"* ]] && [[ "$OUT" == *"SERVICO ESTADO"* ]] && [[ "$OUT" == *"FATAL: timezone do banco"* ]]'
caso "aponta a causa provável (fuso do Postgres) e o rollback" '[[ "$OUT" == *"ALTER DATABASE"* ]] && [[ "$OUT" == *"--rollback"* ]]'
caso "NÃO diz 'Deploy concluído' e NÃO confere o /health depois de falhar" '[[ "$OUT" != *"Deploy concluído"* ]] && ! grep -q "^curl" "$TMP/calls.log"'
caso "pediu os logs de migrate e api" '[[ "$LOG" == *"logs --no-color --tail 60 migrate api"* ]]'
echo "== tempo de espera configurável"
envok; WAIT_ENV=45 roda fail 0 0
caso "DEPLOY_WAIT=45 vira --wait-timeout 45 e a mensagem diz 45s" '[[ "$LOG" == *"--wait-timeout 45"* ]] && [[ "$OUT" == *"em 45s"* ]]'
WAIT_ENV=abc roda ok 0 0
caso "DEPLOY_WAIT inválido é recusado (exit 2) sem chamar o docker" '[ "$RC" = 2 ] && [ -z "$LOG" ]'
WAIT_ENV=""
echo "== a API reiniciou durante a subida mas estabilizou"
envok; roda ok 2 0
caso "avisa que a API reiniciou 2 vezes e NÃO reprova" '[ "$RC" = 0 ] && [[ "$OUT" == *"a API reiniciou 2 vez(es)"* ]]'
echo "== /health não responde"
envok; roda ok 0 22
caso "curl falhando reprova com diagnóstico e sai 1" '[ "$RC" = 1 ] && [[ "$OUT" == *"FALHOU: /health não respondeu"* ]]'
echo "== rollback"
envok; roda ok 0 0 --rollback v1
caso "rollback saudável sobe sem build, com --wait, e sai 0" '[ "$RC" = 0 ] && [[ "$LOG" == *"--no-build"* ]] && [[ "$LOG" == *"--wait"* ]] && ! grep -q " build$" "$TMP/calls.log"'
roda fail 0 0 --rollback v1
caso "rollback que não fica saudável também falha com o log" '[ "$RC" = 1 ] && [[ "$OUT" == *"FALHOU"* ]] && [[ "$OUT" == *"FATAL: timezone"* ]]'

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
