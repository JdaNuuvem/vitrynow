#!/bin/bash
# Teste do infra/alerta.sh (envio de alertas sem spam). saude.sh e curl FALSOS: sem Docker, sem rede, < 5 s.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; INFRA="$HERE/../infra"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/infra" "$TMP/bin"; cp "$INFRA/alerta.sh" "$TMP/infra/"; chmod +x "$TMP/infra/alerta.sh"
PASS=0; FAILS=0

# saude.sh falso: imprime o que está em $TMP/saude.txt e sai com $TMP/saude.rc
cat > "$TMP/infra/saude.sh" <<'EOF'
#!/bin/bash
cat "$STUB_DIR/saude.txt"; exit "$(cat "$STUB_DIR/saude.rc")"
EOF
chmod +x "$TMP/infra/saude.sh"
# curl falso: registra a URL e os dados enviados em $TMP/curl.log
cat > "$TMP/bin/curl" <<'EOF'
#!/bin/bash
url=""; dados=""
while [ $# -gt 0 ]; do case "$1" in -d|--data-urlencode) dados="$dados $2"; shift 2 ;; -m|-o|-H) shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
echo "URL=$url DADOS=$dados" >> "$STUB_DIR/curl.log"; exit "${STUB_CURL_RC:-0}"
EOF
chmod +x "$TMP/bin/curl"

saude() { printf '%s\n' "$2" > "$TMP/saude.txt"; echo "$1" > "$TMP/saude.rc"; }
OUT=""; RC=0
roda() { : > "$TMP/curl.log"; OUT="$(cd "$TMP/infra" && env PATH="$TMP/bin:$PATH" STUB_DIR="$TMP" ENV_FILE=nao-existe ALERT_NAME=teste "$@" ./alerta.sh 2>&1)"; RC=$?; }
envios() { local n; n="$(grep -c '^URL=' "$TMP/curl.log" 2>/dev/null)"; echo "${n:-0}"; }   # 1 chamada = 1 linha URL= (o texto pode ter várias)
caso() { local desc="$1" cond="$2"; if eval "$cond"; then PASS=$((PASS+1)); echo "  [ok]    $desc"; else FAILS=$((FAILS+1)); echo "  [FALHA] $desc"; echo "$OUT" | sed 's/^/          /' | head -10; sed 's/^/          curl: /' "$TMP/curl.log"; fi; }
TG=(ALERT_TELEGRAM_BOT_TOKEN=123:abc ALERT_TELEGRAM_CHAT_ID=42)
OKTXT="== serviços
  [ok]     api: rodando
Tudo ok."
AL1="== backup
  [ALERTA] último backup verificado há 27 h (limite 26 h)"
AL1b="== backup
  [ALERTA] último backup verificado há 28 h (limite 26 h)"
AL2="== serviços
  [ALERTA] api: estado 'exited' (esperado running)"

echo "== primeira rodada e repetição"
rm -f "$TMP/infra/.alerta-estado"
saude 0 "$OKTXT"; roda env "${TG[@]}";       caso "tudo ok na primeira vez: não manda nada, sai 0" '[ "$RC" = 0 ] && [ "$(envios)" = 0 ]'
saude 1 "$AL1";   roda env "${TG[@]}";       caso "novo alerta: manda pelo Telegram com a linha do alerta" '[ "$RC" = 1 ] && [ "$(envios)" = 1 ] && grep -q "api.telegram.org/bot123:abc/sendMessage" "$TMP/curl.log" && grep -q "último backup verificado" "$TMP/curl.log"'
saude 1 "$AL1";   roda env "${TG[@]}";       caso "mesmo alerta logo depois: NÃO manda de novo" '[ "$(envios)" = 0 ] && [[ "$OUT" == *"próximo lembrete"* ]]'
saude 1 "$AL1b";  roda env "${TG[@]}";       caso "mesmo problema com outro número (27 h -> 28 h): NÃO manda" '[ "$(envios)" = 0 ]'
saude 1 "$AL2";   roda env "${TG[@]}";       caso "alerta DIFERENTE: manda na hora" '[ "$(envios)" = 1 ] && grep -q "exited" "$TMP/curl.log"'
saude 1 "$AL2";   roda env "${TG[@]}" ALERT_REPEAT_MINUTES=0; caso "mesmo alerta com o prazo de lembrete vencido: manda 'continua'" '[ "$(envios)" = 1 ] && grep -q "continua" "$TMP/curl.log"'
saude 0 "$OKTXT"; roda env "${TG[@]}";       caso "voltou ao normal: manda 'tudo normal de novo'" '[ "$RC" = 0 ] && [ "$(envios)" = 1 ] && grep -q "tudo normal de novo" "$TMP/curl.log"'
saude 0 "$OKTXT"; roda env "${TG[@]}";       caso "segue normal: não manda nada" '[ "$(envios)" = 0 ]'

echo "== canais"
rm -f "$TMP/infra/.alerta-estado"
saude 1 "$AL2";   roda env ALERT_WEBHOOK_URL=https://hooks.exemplo.invalid/x; caso "webhook: JSON com text e content" '[ "$(envios)" = 1 ] && grep -q "hooks.exemplo.invalid" "$TMP/curl.log" && grep -q "\"text\":" "$TMP/curl.log" && grep -q "\"content\":" "$TMP/curl.log"'
caso "webhook: aspas do texto escapadas (JSON válido)" 'grep -q "estado '"'"'exited'"'"'" "$TMP/curl.log" && ! grep -q "[^\\\\]\"exited" "$TMP/curl.log"'
rm -f "$TMP/infra/.alerta-estado"
saude 1 "$AL2";   roda env;                   caso "sem canal configurado: avisa no log e não chama curl" '[ "$(envios)" = 0 ] && [[ "$OUT" == *"nenhum canal enviou"* ]]'
rm -f "$TMP/infra/.alerta-estado"
saude 1 "$AL2";   roda env "${TG[@]}" STUB_CURL_RC=7; caso "falha de envio não derruba o script (sai com o código do saude)" '[ "$RC" = 1 ] && [[ "$OUT" == *"falha ao enviar pelo Telegram"* ]]'

echo "== heartbeat (homem-morto)"
rm -f "$TMP/infra/.alerta-estado"
saude 0 "$OKTXT"; roda env ALERT_HEARTBEAT_URL=https://hc.exemplo.invalid/abc; caso "tudo ok: ping na URL do heartbeat" 'grep -q "URL=https://hc.exemplo.invalid/abc " "$TMP/curl.log"'
saude 1 "$AL1";   roda env ALERT_HEARTBEAT_URL=https://hc.exemplo.invalid/abc; caso "com alerta: ping em /fail" 'grep -q "URL=https://hc.exemplo.invalid/abc/fail " "$TMP/curl.log"'

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
