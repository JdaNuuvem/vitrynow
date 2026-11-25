#!/bin/bash
# Instantâneo de SAÚDE da stack (INF-08, PARCIAL): o que um operador (ou um cron a cada 5 min) precisa ver sem montar Prometheus/Grafana.
# Rode DENTRO do servidor, na pasta infra/. Só LÊ (docker compose ps/inspect/logs/exec de leitura); não altera nada. Sai 0 se tudo ok, 1 se houver ALERTA.
#
#   ./saude.sh [--minutos 15]        janela dos logs (padrão 15)
#   ENV_FILE=.env                    arquivo de ambiente (padrão .env)
#
# Sinais (todos lidos de coisas que o sistema JÁ emite; limites abaixo são PROPOSTAS iniciais, sem dado de produção para calibrar):
#   1. serviços: rodando, saudáveis (se têm healthcheck) e sem reinício (RestartCount > 0 = crash loop ou queda)
#   2. /health da API por dentro da rede
#   3. último backup verificado (LAST_OK) com menos de 26 h
#   3c. cópia off-site cifrada (perfil offsite) conferida há menos de 28 h; perfil desligado = ALERTA (exceto DEPLOY_ENV=staging)
#   3b. fotos em disco local (ADR-0017): uso do disco onde está o volume /uploads (> 80% = ALERTA) e quantas fotos há
#   4. logs da API na janela: [hashlane] SERVER_BUSY (fila de hash cheia), [*_floor_exceeded] por TAXA (> 1% dos pedidos da rota, mínimo 3 casos; Sun Tzu),
#      [estorno] (erro de estorno), [audit] falha (auditoria que não gravou), respostas 5xx por taxa (> 1% das respostas, mínimo 5)
#   5. ALERTAS DE SEGURANÇA (NG-12b): cada linha "security_alert" que a própria API emite (as regras e limiares ficam em ALERT_RULES, apps/api/src/lib/securityEvents.ts:
#      login falho por IP/conta, origem trocada, chave de impressora recusada, sessão recusada em massa, reset em excesso, back-office) = ALERTA, com o nome da regra e
#      quantas vezes; e um resumo informativo dos "security_event" por tipo (não alerta)
# NÃO cobre: disco/memória do servidor (use o monitoramento do provedor), certificado TLS, nem a fila de impressão (alerta central do PC-24 é outro canal).
set -uo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash no Windows reescreve /backups/LAST_OK como caminho do Windows; no Linux não faz nada
cd "$(dirname "$0")"
ENVF="${ENV_FILE:-.env}"; MIN=15
if [ "${1:-}" = "--minutos" ]; then MIN="${2:-}"; fi
[[ "$MIN" =~ ^[0-9]+$ ]] && [ "$MIN" -ge 1 ] || { echo "uso: saude.sh [--minutos N] (N inteiro >= 1)"; exit 2; }
DC=(docker compose); [ -f "$ENVF" ] && DC=(docker compose --env-file "$ENVF")

ALERTAS=0
ok()     { echo "  [ok]     $*"; }
alerta() { echo "  [ALERTA] $*"; ALERTAS=$((ALERTAS+1)); }
conta()  { local n; n="$(printf '%s\n' "$1" | grep -c -- "$2" || true)"; printf '%s' "${n:-0}"; }   # linhas de $1 que casam $2

echo "== serviços"
PERFIS="${COMPOSE_PROFILES:-}"; [ -z "$PERFIS" ] && [ -f "$ENVF" ] && PERFIS="$(grep -E '^COMPOSE_PROFILES=' "$ENVF" | tail -1 | cut -d= -f2- | tr -d "\"'\r ")"
SERVICOS="postgres api web caddy postgres-backup"; [[ ",$PERFIS," == *",offsite,"* ]] && SERVICOS="$SERVICOS backup-offsite"
for svc in $SERVICOS; do
  cid="$("${DC[@]}" ps -a -q "$svc" 2>/dev/null | head -1)"
  if [ -z "$cid" ]; then alerta "$svc: container não existe"; continue; fi
  est="$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}|{{.RestartCount}}' "$cid" 2>/dev/null)"
  status="${est%%|*}"; rest="${est#*|}"; saude="${rest%%|*}"; reinicios="${rest##*|}"
  if [ "$status" != running ]; then alerta "$svc: estado '$status' (esperado running)"
  elif [ "$saude" != "-" ] && [ "$saude" != healthy ]; then alerta "$svc: saúde '$saude' (esperado healthy)"
  elif [ "${reinicios:-0}" != 0 ]; then alerta "$svc: $reinicios reinício(s) desde que o container foi criado (queda ou crash loop; veja docker compose logs $svc)"
  else ok "$svc: rodando, saúde '$saude', 0 reinícios"; fi
done

echo "== API"
if "${DC[@]}" exec -T api node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ok "GET /health da API responde 200"
else alerta "GET /health da API NÃO respondeu 200"; fi

echo "== backup"
ultimo="$("${DC[@]}" exec -T postgres-backup cat /backups/LAST_OK 2>/dev/null | cut -d' ' -f1 | tr -d '\r\n')"
if [[ "$ultimo" =~ ^[0-9]+$ ]]; then
  idade=$(( $(date -u +%s) - ultimo ))
  if [ "$idade" -le 93600 ]; then ok "último backup verificado há $(( idade / 3600 )) h"; else alerta "último backup verificado há $(( idade / 3600 )) h (limite 26 h)"; fi
else alerta "nenhum backup verificado encontrado (LAST_OK ausente ou ilegível)"; fi
# 3c. cópia OFF-SITE (perfil "offsite"): só é cobrada quando o perfil está ligado no .env (COMPOSE_PROFILES contém offsite)
if [[ ",$PERFIS," == *",offsite,"* ]]; then
  ext="$("${DC[@]}" exec -T backup-offsite cat /state/OFFSITE_LAST_OK 2>/dev/null | cut -d' ' -f1 | tr -d '\r\n')"
  if [[ "$ext" =~ ^[0-9]+$ ]]; then
    idade=$(( $(date -u +%s) - ext ))
    if [ "$idade" -le 100800 ]; then ok "última cópia off-site conferida há $(( idade / 3600 )) h"; else alerta "última cópia off-site conferida há $(( idade / 3600 )) h (limite 28 h): veja docker compose logs backup-offsite"; fi
  else alerta "nenhuma cópia off-site conferida (OFFSITE_LAST_OK ausente): veja docker compose logs backup-offsite"; fi
elif [ "${DEPLOY_ENV:-$( [ -f "$ENVF" ] && grep -E '^DEPLOY_ENV=' "$ENVF" | tail -1 | cut -d= -f2- | tr -d "\"'\r " )}" = staging ]; then
  ok "staging: sem cópia off-site (dados de teste)"
else
  alerta "cópia off-site DESLIGADA: o backup só existe neste servidor (ligue o perfil offsite; RUNBOOK-infra §5c)"
fi

echo "== fotos (disco local, ADR-0017)"
uso="$("${DC[@]}" exec -T api df -P /uploads 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%\r\n')"
if [[ "$uso" =~ ^[0-9]+$ ]]; then
  nfotos="$("${DC[@]}" exec -T api find /uploads -type f 2>/dev/null | wc -l | tr -d ' \r\n')"
  if [ "$uso" -ge 80 ]; then alerta "disco das fotos com $uso% de uso (limite 80%): $nfotos foto(s); amplie o disco ou revise o limite por loja"; else ok "disco das fotos com $uso% de uso, $nfotos foto(s)"; fi
else alerta "não consegui medir o disco das fotos (docker compose exec api df -P /uploads falhou: volume não montado?)"; fi

echo "== logs da API (últimos $MIN min)"
LOG="$("${DC[@]}" logs --since "${MIN}m" --no-color api 2>/dev/null)"
if [ -z "$LOG" ]; then alerta "a API não gerou NENHUMA linha de log em $MIN min (parada? log desligado?)"; else
  busy="$(conta "$LOG" '\[hashlane\]')"
  [ "$busy" = 0 ] && ok "fila de hash de senha: nenhuma recusa 503 SERVER_BUSY" || alerta "fila de hash de senha recusou pedidos (503 SERVER_BUSY): $busy aviso(s); possível ataque de login ou máquina pequena demais"
  for rota in reset forgot; do
    caminho="/auth/reset-password"; [ "$rota" = forgot ] && caminho="/auth/forgot-password"
    casos="$(conta "$LOG" "\[${rota}_floor_exceeded\]")"; total="$(conta "$LOG" "\"url\":\"$caminho[\"?]")"
    if [ "$casos" -ge 3 ] && [ $(( casos * 100 )) -gt "$total" ]; then alerta "piso de tempo estourado em $casos de $total pedidos de $caminho (> 1%): o piso está curto para esta máquina ou há lentidão no banco"
    else ok "piso de tempo de $caminho: $casos estouro(s) em $total pedido(s)"; fi
  done
  est="$(conta "$LOG" '\[estorno\]')"; [ "$est" = 0 ] && ok "estorno: nenhuma linha de erro" || alerta "estorno: $est linha(s) de erro (provedor recusou ou conclusão falhou); confira os pedidos CANCELADO sem devolução"
  alertas_seg="$(printf '%s\n' "$LOG" | grep '"msg":"security_alert"' || true)"
  if [ -n "$alertas_seg" ]; then
    resumo="$(printf '%s\n' "$alertas_seg" | grep -o '"securityAlert":"[A-Z_]*"' | cut -d'"' -f4 | sort | uniq -c | awk '{printf "%s×%s ", $2, $1}')"
    alerta "alerta(s) de SEGURANÇA emitidos pela API: $resumo(veja docs/RUNBOOK-infra.md §16: o que fazer por regra; nunca há IP cru nem e-mail no log)"
  else ok "segurança: nenhum security_alert na janela"; fi
  eventos_seg="$(printf '%s\n' "$LOG" | grep '"msg":"security_event"' | grep -o '"securityEvent":"[a-z_]*"' | cut -d'"' -f4 | sort | uniq -c | awk '{printf "%s=%s ", $2, $1}')"
  [ -z "$eventos_seg" ] && ok "segurança: nenhum security_event na janela" || ok "segurança: eventos na janela (informativo): $eventos_seg"
  aud="$(conta "$LOG" '\[audit\] falha')"; [ "$aud" = 0 ] && ok "auditoria: nenhuma falha ao gravar" || alerta "auditoria: $aud falha(s) ao gravar (ação sensível sem rastro)"
  concl="$(conta "$LOG" '"msg":"request completed"')"; c5="$(printf '%s\n' "$LOG" | grep '"msg":"request completed"' | grep -c '"statusCode":5' || true)"
  if [ "${c5:-0}" -ge 5 ] && [ $(( c5 * 100 )) -gt "$concl" ]; then alerta "respostas 5xx: $c5 de $concl (> 1%)"; else ok "respostas 5xx: ${c5:-0} de $concl"; fi
fi

echo
if [ "$ALERTAS" -gt 0 ]; then echo "$ALERTAS alerta(s). Veja docs/RUNBOOK-infra.md (seção 16)."; exit 1; fi
echo "Tudo ok."
