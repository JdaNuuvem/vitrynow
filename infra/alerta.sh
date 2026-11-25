#!/bin/bash
# ALERTAS que chegam em alguém (INF-08): roda o saude.sh e AVISA por mensagem quando algo muda. Feito para o cron do servidor:
#
#   */5 * * * *  cd /caminho/vitrynow/infra && ./alerta.sh >> /var/log/vitry-alerta.log 2>&1
#
# Canais (preencha UM ou mais no .env; vazios = só imprime):
#   ALERT_TELEGRAM_BOT_TOKEN + ALERT_TELEGRAM_CHAT_ID   bot do Telegram (o mais simples no celular)
#   ALERT_WEBHOOK_URL                                   webhook do Slack, Discord ou Google Chat (manda {"text":..., "content":...})
#   ALERT_HEARTBEAT_URL                                 "homem-morto" (ex.: healthchecks.io): recebe um GET a CADA rodada sem alerta e
#                                                       /fail com alerta. Se o SERVIDOR cair, o cron para e é o serviço externo que avisa.
# Regras de envio (sem spam):
#   - novo problema (ou conjunto de alertas diferente)  -> manda na hora
#   - o MESMO problema continua                          -> lembra a cada ALERT_REPEAT_MINUTES (padrão 60)
#   - voltou ao normal                                   -> manda "resolvido"
# Nunca manda segredo: o texto é só o que o saude.sh imprime (ele não imprime IP cru, e-mail nem valor de .env).
set -uo pipefail
cd "$(dirname "$0")"
ENVF="${ENV_FILE:-.env}"
if [ -f "$ENVF" ]; then set -a; . "./$ENVF" >/dev/null 2>&1; set +a; fi
STATE="${ALERT_STATE_FILE:-./.alerta-estado}"
REPEAT=$(( ${ALERT_REPEAT_MINUTES:-60} * 60 ))
NOME="${ALERT_NAME:-${DOMAIN:-vitry}}"

SAIDA="$(./saude.sh "$@" 2>&1)"; RC=$?
LINHAS="$(printf '%s\n' "$SAIDA" | grep '\[ALERTA\]' | sed 's/^ *\[ALERTA\] *//' || true)"
# assinatura do conjunto de alertas SEM números que mudam a cada rodada (idade, contagens): "há 27 h" e "há 28 h" são o mesmo problema
ASSIN="$(printf '%s\n' "$LINHAS" | sed 's/[0-9]\+/N/g' | sort | (sha256sum 2>/dev/null || shasum -a 256) | cut -c1-16)"
AGORA="$(date -u +%s)"
ANT_ASSIN=""; ANT_ENVIO=0; ANT_RC=0
if [ -f "$STATE" ]; then read -r ANT_RC ANT_ASSIN ANT_ENVIO < "$STATE" || true; fi

envia() { # $1 = texto
  local txt="$1" ok=0 json
  echo "--- envio: $(printf '%s' "$txt" | head -1)"
  if [ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS -m 15 -o /dev/null "https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT_ID}" --data-urlencode "text=${txt}" && ok=1 || echo "  falha ao enviar pelo Telegram"
  fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    json="$(printf '%s' "$txt" | sed 's/\\/\\\\/g; s/"/\\"/g' | awk 'BEGIN{ORS="\\n"} {print}')"
    curl -fsS -m 15 -o /dev/null -H 'Content-Type: application/json' -d "{\"text\":\"${json}\",\"content\":\"${json}\"}" "$ALERT_WEBHOOK_URL" && ok=1 || echo "  falha ao enviar pelo webhook"
  fi
  [ "$ok" = 1 ] || echo "  (nenhum canal enviou: configure ALERT_TELEGRAM_* ou ALERT_WEBHOOK_URL)"
  return 0
}

if [ -n "${ALERT_HEARTBEAT_URL:-}" ]; then
  if [ "$RC" = 0 ]; then curl -fsS -m 10 -o /dev/null "$ALERT_HEARTBEAT_URL" || echo "heartbeat: falha no ping"
  else curl -fsS -m 10 -o /dev/null "${ALERT_HEARTBEAT_URL%/}/fail" || echo "heartbeat: falha no ping /fail"; fi
fi

ENVIO="$ANT_ENVIO"
if [ "$RC" != 0 ]; then
  N="$(printf '%s\n' "$LINHAS" | grep -c . || true)"
  TXT="🔴 ${NOME}: ${N} alerta(s)
$(printf '%s\n' "$LINHAS" | sed 's/^/• /')
(o que fazer: docs/RUNBOOK-infra.md §16)"
  if [ "$ASSIN" != "$ANT_ASSIN" ] || [ "$ANT_RC" = 0 ]; then envia "$TXT"; ENVIO="$AGORA"
  elif [ $(( AGORA - ANT_ENVIO )) -ge "$REPEAT" ]; then envia "⏰ continua: $TXT"; ENVIO="$AGORA"
  else echo "mesmos alertas de antes; próximo lembrete em $(( (REPEAT - (AGORA - ANT_ENVIO)) / 60 )) min"; fi
elif [ "$ANT_RC" != 0 ]; then
  envia "✅ ${NOME}: tudo normal de novo"; ENVIO="$AGORA"; ASSIN=""
else
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) tudo ok"; ASSIN=""
fi
printf '%s %s %s\n' "$RC" "${ASSIN:--}" "$ENVIO" > "$STATE"
exit "$RC"
