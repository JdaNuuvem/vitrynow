#!/bin/bash
# Deploy do MeuCardapio (docker compose). Rode DENTRO do servidor, na pasta infra/ do repositório.
#
#   ./deploy.sh --check        só valida o .env com infra/check-env.sh (não toca em nada)
#   ./deploy.sh                valida, faz BACKUP VERIFICADO, constrói, migra, sobe, ESPERA a pilha ficar saudável e confere /health
#   ./deploy.sh --rollback V   sobe de novo as imagens já construídas com APP_VERSION=V (ver docs/RUNBOOK-infra.md)
#
#   DEPLOY_WAIT=180            segundos que a pilha tem para ficar saudável antes de o deploy FALHAR (padrão 180)
#   ENV_FILE=.env              arquivo de ambiente (padrão .env)
#
# Nunca roda sem backup verificado quando já existe banco com tabelas. Se o build ou a migração falharem, para e NÃO derruba a versão que está
# no ar (o compose só troca os containers depois do build e da migração).
# POR QUE ESPERAR A SAÚDE: a API recusa subir quando o Postgres está fora de UTC (guarda do SEC-32) e o `restart: unless-stopped` a sobe de novo
# e de novo (crash loop visível). `docker compose up -d` sozinho NÃO falha nesse caso; `up --wait` falha, e este script mostra o estado e o log.
# ATENÇÃO: este script mexe no servidor onde for rodado. Produção só com aprovação explícita do Claudio. NUNCA foi executado em servidor real:
# só testado com docker/curl falsos (scripts/test-deploy.sh) e, em DEV, pelo smoke da stack (scripts/smoke-stack.sh).
set -euo pipefail
cd "$(dirname "$0")"
ENVF="${ENV_FILE:-.env}"
WAIT="${DEPLOY_WAIT:-180}"
MODE="deploy"; ROLLBACK_TO=""
case "${1:-}" in
  --check) MODE="check" ;;
  --rollback) MODE="rollback"; ROLLBACK_TO="${2:?uso: deploy.sh --rollback <APP_VERSION>}" ;;
  "") ;;
  *) echo "uso: deploy.sh [--check | --rollback <APP_VERSION>]"; exit 2 ;;
esac
[[ "$WAIT" =~ ^[0-9]+$ ]] || { echo "DEPLOY_WAIT precisa ser um número de segundos (veio '$WAIT')"; exit 2; }

[ -f "$ENVF" ] || { echo "arquivo $ENVF não existe (copie .env.example e preencha)"; exit 2; }
echo "== validando $ENVF (infra/check-env.sh --prod; não imprime valores de segredo)"
if ! ./check-env.sh --prod "$ENVF"; then echo "ABORTADO: $ENVF inválido; nada foi alterado."; exit 1; fi
[ "$MODE" = "check" ] && exit 0
WO="$(set -a; . "./$ENVF" >/dev/null 2>&1; set +a; printf '%s' "${WEB_ORIGIN:-}")"
APPV="$(set -a; . "./$ENVF" >/dev/null 2>&1; set +a; printf '%s' "${APP_VERSION:-}")"

DC=(docker compose --env-file "$ENVF")
"${DC[@]}" config -q

diagnostico() { # $1 = motivo
  echo "FALHOU: $1"
  echo "--- estado dos serviços:"; "${DC[@]}" ps -a || true
  echo "--- últimas linhas do migrate e da api:"; "${DC[@]}" logs --no-color --tail 60 migrate api 2>&1 || true
  echo "--- o que olhar:"
  echo "  * erro da api falando em 'timezone': o Postgres está fora de UTC (SEC-32); corrija: ALTER DATABASE <banco> SET timezone TO 'UTC' e rode de novo"
  echo "  * migrate falhou: docs/RUNBOOK-infra.md seção 4 (prisma migrate resolve --rolled-back)"
  echo "  * a versão anterior NÃO foi derrubada se o build ou a migração falharam; rollback: ./deploy.sh --rollback <APP_VERSION anterior>"
}
# Sobe e ESPERA ficar saudável (migrate concluído, api e web com healthcheck ok). Falha com o diagnóstico se não ficar em $WAIT segundos.
sobe() { "${DC[@]}" up -d --remove-orphans --wait --wait-timeout "$WAIT" "$@" || { diagnostico "a pilha não ficou saudável em ${WAIT}s"; exit 1; }; }
# Reinício da API durante a subida é sinal de crash loop que estabilizou (ou está prestes a voltar): avisa, não reprova.
confere_reinicios() {
  local cid n; cid="$("${DC[@]}" ps -q api 2>/dev/null | head -1)"
  [ -n "$cid" ] || return 0
  n="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 0)"
  [[ "$n" =~ ^[0-9]+$ ]] || n=0
  [ "$n" -gt 0 ] && echo "  [aviso] a API reiniciou $n vez(es) durante a subida: confira 'docker compose logs api' (guarda de fuso, banco, segredo)"
  return 0
}

if [ "$MODE" = "rollback" ]; then
  echo "== rollback para APP_VERSION=$ROLLBACK_TO (sem rebuild; o schema do banco NÃO volta: ver RUNBOOK)"
  docker image inspect "meucardapio-api:$ROLLBACK_TO" "meucardapio-web:$ROLLBACK_TO" >/dev/null || { echo "imagens $ROLLBACK_TO não existem neste servidor"; exit 1; }
  APP_VERSION="$ROLLBACK_TO" sobe --no-build
  confere_reinicios
  exit 0
fi

echo "== backup verificado antes de mexer em qualquer coisa"
if "${DC[@]}" ps --status running --services 2>/dev/null | grep -qx postgres-backup; then
  "${DC[@]}" exec -T postgres-backup /bin/sh /scripts/backup.sh || { echo "ABORTADO: o backup falhou; nada foi alterado."; exit 1; }
else
  echo "  (primeira implantação: serviço de backup ainda não existe; sem banco para proteger)"
fi

echo "== construindo imagens (APP_VERSION=$APPV)"
"${DC[@]}" build
echo "== migrando e subindo (o migrate roda antes da API) e esperando a pilha ficar saudável (até ${WAIT}s)"
sobe
confere_reinicios
echo "== conferindo"
curl -fsS "$WO/health" >/dev/null && echo "  /health ok em $WO" || { diagnostico "/health não respondeu em $WO (DNS/TLS ainda propagando, ou a API não está de pé)"; exit 1; }
echo "Deploy concluído. Versão anterior segue em disco; rollback: ./deploy.sh --rollback <APP_VERSION anterior>"
