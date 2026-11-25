#!/bin/bash
# Teste do infra/saude.sh (INF-08, parcial). Roda com docker FALSO no PATH (sem Docker real, sem rede, < 10 s). Cada caso monta um cenário e confere o ALERTA (ou o ok).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; INFRA="$HERE/../infra"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/infra" "$TMP/bin"; cp "$INFRA/saude.sh" "$TMP/infra/"; chmod +x "$TMP/infra/saude.sh"
PASS=0; FAILS=0

cat > "$TMP/bin/docker" <<'EOF'
#!/bin/bash
case "$*" in
  *" ps -a -q "*) a="$*"; svc="${a##* }"; [ "${STUB_SEM:-}" = "$svc" ] && exit 0; echo "cid-$svc"; exit 0 ;;
  "inspect -f "*) a="$*"; cid="${a##* }"; svc="${cid#cid-}"
     case "$svc" in
       "${STUB_PARADO:-}") echo "exited|-|0" ;;
       "${STUB_DOENTE:-}") echo "running|unhealthy|0" ;;
       "${STUB_REINICIOU:-}") echo "running|healthy|${STUB_REINICIOS:-3}" ;;
       web) echo "running|-|0" ;;
       *) echo "running|healthy|0" ;;
     esac; exit 0 ;;
  *" exec -T api node -e"*) exit "${STUB_HEALTH:-0}" ;;
  *" exec -T postgres-backup cat /backups/LAST_OK"*) [ "${STUB_BACKUP:-}" = ausente ] && exit 1; echo "$(( $(date -u +%s) - ${STUB_BACKUP_IDADE:-3600} )) abc"; exit 0 ;;
  *" exec -T backup-offsite cat /state/OFFSITE_LAST_OK"*) [ "${STUB_OFFSITE:-}" = ausente ] && exit 1; echo "$(( $(date -u +%s) - ${STUB_OFFSITE_IDADE:-3600} )) abc.dump"; exit 0 ;;
  *" exec -T api df -P /uploads"*) [ "${STUB_DF:-}" = falha ] && exit 1; printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 500 500 %s%% /uploads\n' "${STUB_DF:-50}"; exit 0 ;;
  *" exec -T api find /uploads"*) printf '/uploads/a.webp\n/uploads/b.webp\n/uploads/c.webp\n'; exit 0 ;;
  *" logs "*) cat "$STUB_LOGFILE" 2>/dev/null; exit 0 ;;
esac
exit 0
EOF
chmod +x "$TMP/bin/docker"

REQ_RESET='{"level":30,"msg":"incoming request","req":{"method":"POST","url":"/auth/reset-password"}}'
REQ_FORGOT='{"level":30,"msg":"incoming request","req":{"method":"POST","url":"/auth/forgot-password"}}'
OKRES='{"level":30,"msg":"request completed","res":{"statusCode":200}}'
ERRRES='{"level":50,"msg":"request completed","res":{"statusCode":500}}'
logbom() { local i; for i in $(seq 1 20); do echo "$REQ_RESET"; echo "$REQ_FORGOT"; echo "$OKRES"; echo "$OKRES"; done; }   # 20+20 pedidos, 40 respostas 200

OUT=""; RC=0
roda() { : > "$TMP/log.txt"; [ -n "${LOGFN:-}" ] && $LOGFN > "$TMP/log.txt"; OUT="$(cd "$TMP/infra" && env PATH="$TMP/bin:$PATH" STUB_LOGFILE="$TMP/log.txt" "$@" ./saude.sh $ARGS 2>&1)"; RC=$?; }
caso() { local desc="$1" cond="$2"; if eval "$cond"; then PASS=$((PASS+1)); echo "  [ok]    $desc"; else FAILS=$((FAILS+1)); echo "  [FALHA] $desc"; echo "$OUT" | sed 's/^/          /' | head -14; fi; }
export COMPOSE_PROFILES=offsite   # cenário padrão = produção completa (cópia off-site ligada)
ARGS=""; LOGFN=logbom

echo "== tudo saudável"
roda env
caso "sai 0 e diz 'Tudo ok.'" '[ "$RC" = 0 ] && [[ "$OUT" == *"Tudo ok."* ]] && [[ "$OUT" != *"[ALERTA]"* ]]'

echo "== serviços"
roda env STUB_PARADO=api;       caso "serviço parado: ALERTA e exit 1" '[ "$RC" = 1 ] && [[ "$OUT" == *"api: estado '"'"'exited'"'"'"* ]]'
roda env STUB_DOENTE=postgres;  caso "serviço unhealthy: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"postgres: saúde '"'"'unhealthy'"'"'"* ]]'
roda env STUB_REINICIOU=api;    caso "serviço com reinícios: ALERTA com a contagem" '[ "$RC" = 1 ] && [[ "$OUT" == *"api: 3 reinício(s)"* ]]'
roda env STUB_SEM=caddy;        caso "container inexistente: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"caddy: container não existe"* ]]'
roda env;                       caso "web (sem healthcheck) rodando conta como ok" '[[ "$OUT" == *"web: rodando, saúde '"'"'-'"'"'"* ]]'

echo "== /health e backup"
roda env STUB_HEALTH=1;         caso "/health fora: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"/health da API NÃO respondeu"* ]]'
roda env STUB_BACKUP_IDADE=100000; caso "backup com mais de 26 h: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"último backup verificado há 27 h"* ]]'
roda env STUB_BACKUP=ausente;   caso "sem LAST_OK: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"nenhum backup verificado"* ]]'

echo "== cópia off-site (perfil offsite)"
roda env;                         caso "off-site conferida há 1 h: ok" ' [[ "$OUT" == *"última cópia off-site conferida há 1 h"* ]]'
roda env STUB_OFFSITE_IDADE=110000; caso "off-site com mais de 28 h: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"cópia off-site conferida há 30 h"* ]]'
roda env STUB_OFFSITE=ausente;    caso "off-site sem OFFSITE_LAST_OK: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"nenhuma cópia off-site conferida"* ]]'
roda env STUB_PARADO=backup-offsite; caso "serviço backup-offsite parado: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"backup-offsite: estado"* ]]'
roda env COMPOSE_PROFILES=;       caso "perfil offsite desligado: ALERTA (backup só no servidor)" '[ "$RC" = 1 ] && [[ "$OUT" == *"cópia off-site DESLIGADA"* ]]'

roda env COMPOSE_PROFILES= DEPLOY_ENV=staging; caso "staging sem off-site: ok (não alerta)" '[ "$RC" = 0 ] && [[ "$OUT" == *"staging: sem cópia off-site"* ]]'

echo "== fotos (disco local)"
roda env;                       caso "disco das fotos com 50%: ok, com a contagem de fotos" '[[ "$OUT" == *"disco das fotos com 50% de uso, 3 foto(s)"* ]]'
roda env STUB_DF=85;            caso "disco das fotos com 85%: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"disco das fotos com 85% de uso"* ]]'
roda env STUB_DF=80;            caso "disco das fotos com exatamente 80%: ALERTA (limite inclusivo)" '[ "$RC" = 1 ] && [[ "$OUT" == *"disco das fotos com 80%"* ]]'
roda env STUB_DF=79;            caso "disco das fotos com 79%: ok" '[ "$RC" = 0 ]'
roda env STUB_DF=falha;         caso "df falha (volume não montado): ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"não consegui medir o disco das fotos"* ]]'

echo "== logs da API"
logfila() { logbom; echo '[hashlane] pedidos recusados com 503 SERVER_BUSY (fila cheia: 4, teto por origem: 0, espera esgotada: 0; acumulado 4)'; }
LOGFN=logfila; roda env;         caso "recusas da fila de hash (SERVER_BUSY): ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"fila de hash de senha recusou"* ]]'
logfloor_alto() { logbom; for i in 1 2 3 4; do echo '[reset_floor_exceeded] a resposta passou do piso de tempo: 310 ms > 300 ms (total no processo: 1)'; done; }
LOGFN=logfloor_alto; roda env;   caso "piso estourado em 4 de 20 pedidos de reset (20%): ALERTA por taxa" '[ "$RC" = 1 ] && [[ "$OUT" == *"4 de 20 pedidos de /auth/reset-password"* ]]'
logfloor_baixo() { for i in $(seq 1 400); do echo "$REQ_RESET"; done; for i in 1 2 3; do echo '[reset_floor_exceeded] a resposta passou do piso de tempo: 310 ms > 300 ms (total no processo: 1)'; done; echo "$OKRES"; }
LOGFN=logfloor_baixo; roda env;  caso "piso estourado 3× em 400 pedidos (0,75%): NÃO alerta" '[ "$RC" = 0 ] && [[ "$OUT" == *"3 estouro(s) em 400 pedido(s)"* ]]'
logfloor_poucos() { logbom; echo '[forgot_floor_exceeded] a resposta passou do piso de tempo: 410 ms > 350 ms (total no processo: 1)'; }
LOGFN=logfloor_poucos; roda env; caso "1 estouro em 20 pedidos: abaixo do mínimo de 3 casos, NÃO alerta" '[ "$RC" = 0 ]'
logestorno() { logbom; echo '[estorno] provedor recusou o estorno do pagamento p1: status=500 code=?'; }
LOGFN=logestorno; roda env;      caso "erro de estorno: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"estorno: 1 linha(s) de erro"* ]]'
logaud() { logbom; echo '[audit] falha ao gravar tentativa negada de troca de modo: PrismaClientUnknownRequestError'; }
LOGFN=logaud; roda env;          caso "falha de auditoria: ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"auditoria: 1 falha(s)"* ]]'
log5xx() { for i in $(seq 1 30); do echo "$OKRES"; done; for i in 1 2 3 4 5 6; do echo "$ERRRES"; done; }
LOGFN=log5xx; roda env;          caso "6 respostas 5xx em 36 (> 1%): ALERTA" '[ "$RC" = 1 ] && [[ "$OUT" == *"respostas 5xx: 6 de 36"* ]]'
log5xx_baixo() { for i in $(seq 1 600); do echo "$OKRES"; done; for i in 1 2 3 4 5; do echo "$ERRRES"; done; }
LOGFN=log5xx_baixo; roda env;    caso "5 respostas 5xx em 605 (0,8%): NÃO alerta" '[ "$RC" = 0 ]'
logvazio() { :; }
LOGFN=logvazio; roda env;        caso "log vazio: ALERTA (a API parou de logar)" '[ "$RC" = 1 ] && [[ "$OUT" == *"NENHUMA linha de log"* ]]'

echo "== alertas de segurança (NG-12b)"
SA1='{"level":50,"msg":"security_alert","securityAlert":"LOGIN_FAILURES_PER_IP","scope":"ip","key":"203.0.113.0","count":11,"windowSec":300}'
SA2='{"level":50,"msg":"security_alert","securityAlert":"ORIGIN_MISMATCH_BURST","scope":"ip","key":"198.51.100.0","count":6,"windowSec":300}'
SE='{"level":40,"msg":"security_event","securityEvent":"login_failed","ipKey":"203.0.113.0"}'
logseg_alerta() { logbom; echo "$SA1"; echo "$SA1"; echo "$SA2"; echo "$SE"; echo "$SE"; }
LOGFN=logseg_alerta; roda env;   caso "security_alert: ALERTA com o nome de cada regra e a contagem" '[ "$RC" = 1 ] && [[ "$OUT" == *"LOGIN_FAILURES_PER_IP×2"* ]] && [[ "$OUT" == *"ORIGIN_MISMATCH_BURST×1"* ]]'
logseg_eventos() { logbom; echo "$SE"; echo "$SE"; echo '{"level":30,"msg":"security_event","securityEvent":"session_rejected"}'; }
LOGFN=logseg_eventos; roda env;  caso "só security_event (sem alerta): NÃO alerta e mostra o resumo por tipo" '[ "$RC" = 0 ] && [[ "$OUT" == *"login_failed=2"* ]] && [[ "$OUT" == *"session_rejected=1"* ]]'
LOGFN=logbom; roda env;          caso "sem eventos de segurança: ok nas duas linhas" '[ "$RC" = 0 ] && [[ "$OUT" == *"nenhum security_alert"* ]] && [[ "$OUT" == *"nenhum security_event"* ]]'
caso "nenhum IP nem e-mail aparece na saída do alerta (só nome da regra e contagem)" 'LOGFN=logseg_alerta; roda env; [[ "$OUT" != *"203.0.113"* && "$OUT" != *"198.51.100"* ]]'

echo "== argumentos"
LOGFN=logbom; ARGS="--minutos abc"; roda env; caso "--minutos inválido: exit 2" '[ "$RC" = 2 ]'
ARGS="--minutos 5";  roda env; caso "--minutos 5 aparece no cabeçalho dos logs" '[[ "$OUT" == *"últimos 5 min"* ]]'

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
