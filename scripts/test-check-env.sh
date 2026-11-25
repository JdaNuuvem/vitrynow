#!/bin/bash
# Teste do validador infra/check-env.sh. Sem Docker, sem rede, < 5 s. Os "segredos" abaixo são fictícios e descartáveis.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; CHK="$HERE/../infra/check-env.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAILS=0
S1="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"; S2="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2"; S3="cccccccccccccccccccccccccccccccccccccccc3"; S4="dddddddddddddddddddddddddddddddddddddddd4"
S5="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee5"; PG="ffffffffffffffffffffffffffffffff"
base() { cat <<EOF
POSTGRES_PASSWORD=$PG
JWT_SECRET=$S1
MFA_HMAC_KEY=$S2
API_INTERNAL_SECRET=$S3
DOMAIN=pedidos.exemplo.invalid
ACME_EMAIL=ops@exemplo.invalid
APP_VERSION=abc1234
WEB_ORIGIN=https://pedidos.exemplo.invalid
NEXT_PUBLIC_API_URL=https://pedidos.exemplo.invalid
EOF
}
real() { cat <<EOF
MP_OAUTH_MODE=real
PAYMENT_ENC_KEY=$S4
MP_CLIENT_ID=1234567890
MP_CLIENT_SECRET=segredo-do-painel-mp
PUBLIC_API_URL=https://pedidos.exemplo.invalid
EOF
}
sem()  { sed "/^$1=/d"; }                  # remove a variável $1
troca() { sed "s#^$1=.*#$1=$2#"; }         # troca o valor de $1
# caso <descrição> <exit esperado> <trecho esperado ("" = qualquer)> <conteúdo do .env>
caso() {
  local desc="$1" want="$2" frag="$3" content="$4"; local f="$TMP/e.env"; printf '%s\n' "$content" > "$f"
  local out rc; out="$(bash "$CHK" ${ARGS:-} "$f" 2>&1)"; rc=$?
  if [ "$rc" = "$want" ] && { [ -z "$frag" ] || [[ "$out" == *"$frag"* ]]; }; then PASS=$((PASS+1)); echo "  [ok]    $desc"
  else FAILS=$((FAILS+1)); echo "  [FALHA] $desc (exit=$rc, esperado $want, trecho '$frag')"; echo "$out" | sed 's/^/          /' | head -12; fi
  # segurança: nenhum valor de segredo pode aparecer na saída
  for s in "$S1" "$S2" "$S3" "$S4" "$S5" "$PG" "segredo-do-painel-mp" "segredo-offsite-ficticio" "sal-ficticio-0123456789"; do
    if [[ "$out" == *"$s"* ]]; then FAILS=$((FAILS+1)); echo "  [FALHA] VAZOU um valor de segredo na saída em: $desc"; fi
  done
}

echo "== caminho feliz"
caso "PIX desligado (padrão): só a base já passa" 0 "nenhuma variável do PIX é exigida" "$(base)"
caso "MP_OAUTH_MODE=off explícito passa" 0 "" "$(base; echo MP_OAUTH_MODE=off)"
caso "PIX real completo passa" 0 "OK:" "$(base; real)"
echo "== base"
caso "sem JWT_SECRET reprova" 1 "JWT_SECRET está vazio" "$(base | sem JWT_SECRET)"
caso "JWT_SECRET curto reprova" 1 "JWT_SECRET curto" "$(base | troca JWT_SECRET curto)"
caso "JWT_SECRET igual a MFA_HMAC_KEY reprova (sem imprimir o valor)" 1 "têm o MESMO valor" "$(base | troca MFA_HMAC_KEY "$S1")"
caso "sem API_INTERNAL_SECRET reprova" 1 "API_INTERNAL_SECRET" "$(base | sem API_INTERNAL_SECRET)"
caso "senha do Postgres com / e + reprova" 1 "POSTGRES_PASSWORD precisa" "$(base | troca POSTGRES_PASSWORD 'abc/def+ghi/jkl+mno/pqr12')"
caso "WEB_ORIGIN http reprova" 1 "WEB_ORIGIN deve ser https" "$(base | troca WEB_ORIGIN http://pedidos.exemplo.invalid)"
caso "WEB_ORIGIN com barra final reprova" 1 "sem barra final" "$(base | troca WEB_ORIGIN https://pedidos.exemplo.invalid/)"
caso "COOKIE_SECURE=false reprova" 1 "COOKIE_SECURE=false" "$(base; echo COOKIE_SECURE=false)"
caso "TRUST_PROXY_CIDR definido à parte reprova" 1 "deriva de CADDY_IP" "$(base; echo TRUST_PROXY_CIDR=172.29.250.10/32)"
caso "comentários e MFA_ENFORCED=true com comentário na linha passam" 0 "" "$(base; echo '# comentário'; echo 'MFA_ENFORCED=true # ligado')"
echo "== PIX por loja"
caso "real sem PAYMENT_ENC_KEY reprova" 1 "PAYMENT_ENC_KEY está vazio" "$(base; real | sem PAYMENT_ENC_KEY)"
caso "PAYMENT_ENC_KEY igual ao JWT_SECRET reprova" 1 "têm o MESMO valor" "$(base; real | troca PAYMENT_ENC_KEY "$S1")"
caso "real sem MP_CLIENT_ID reprova" 1 "MP_CLIENT_ID está vazio" "$(base; real | sem MP_CLIENT_ID)"
caso "real sem MP_CLIENT_SECRET reprova" 1 "MP_CLIENT_SECRET está vazio" "$(base; real | sem MP_CLIENT_SECRET)"
caso "real com PUBLIC_API_URL http reprova" 1 "PUBLIC_API_URL deve ser https" "$(base; real | troca PUBLIC_API_URL http://pedidos.exemplo.invalid)"
caso "PAYMENT_ENC_KEY_ID inválido reprova" 1 "PAYMENT_ENC_KEY_ID inválido" "$(base; real; echo PAYMENT_ENC_KEY_ID=ruim.id)"
caso "rotação só com PREV (sem PREV_ID) reprova" 1 "só valem em PAR" "$(base; real; echo "PAYMENT_ENC_KEY_PREV=$S5")"
caso "rotação só com PREV_ID (sem PREV) reprova" 1 "só valem em PAR" "$(base; real; echo PAYMENT_ENC_KEY_PREV_ID=v0)"
caso "PREV igual à chave atual reprova" 1 "é igual à atual" "$(base; real; echo "PAYMENT_ENC_KEY_PREV=$S4"; echo PAYMENT_ENC_KEY_PREV_ID=v0)"
caso "PREV_ID igual a KEY_ID reprova" 1 "PAYMENT_ENC_KEY_PREV_ID é igual" "$(base; real; echo PAYMENT_ENC_KEY_ID=v2; echo "PAYMENT_ENC_KEY_PREV=$S5"; echo PAYMENT_ENC_KEY_PREV_ID=v2)"
caso "rotação válida passa, com aviso para esvaziar o PREV depois" 0 "rotação de chave do PIX em andamento" "$(base; real; echo PAYMENT_ENC_KEY_ID=v2; echo "PAYMENT_ENC_KEY_PREV=$S5"; echo PAYMENT_ENC_KEY_PREV_ID=v1)"
caso "MP_OAUTH_MODE=fake reprova fora de dev" 1 "só para desenvolvimento" "$(base; echo MP_OAUTH_MODE=fake)"
caso "MP_OAUTH_MODE inválido reprova" 1 "inválido" "$(base; echo MP_OAUTH_MODE=talvez)"
caso "chave do PIX preenchida com o modo off: aviso, não erro" 0 "MP_OAUTH_MODE=off a ignora" "$(base; echo "PAYMENT_ENC_KEY=$S4")"
caso "PRIVACY_ACTIONS_ENABLED=true sem PRIVACY_ACTIONS_LEGAL_OK reprova" 1 "PRIVACY_ACTIONS_LEGAL_OK" "$(base; echo PRIVACY_ACTIONS_ENABLED=true)"
caso "PRIVACY_ACTIONS_ENABLED=true com PRIVACY_ACTIONS_LEGAL_OK=true passa" 0 "" "$(base; echo PRIVACY_ACTIONS_ENABLED=true; echo PRIVACY_ACTIONS_LEGAL_OK=true; echo PRIVACY_HASH_SALT=$S5)"
caso "PRIVACY_ACTIONS_ENABLED desligada passa" 0 "" "$(base; echo PRIVACY_ACTIONS_ENABLED=false)"
caso "PRIVACY_ACTIONS_ENABLED=true sem PRIVACY_HASH_SALT reprova" 1 "PRIVACY_HASH_SALT" "$(base; echo PRIVACY_ACTIONS_ENABLED=true; echo PRIVACY_ACTIONS_LEGAL_OK=true)"

# --- INF-19/C2: --prod transforma os riscos em ERRO (e sem --prod continuam avisos)
STORAGE() { echo STORAGE_S3_ENDPOINT=https://s3.exemplo.invalid; echo STORAGE_S3_BUCKET=cardapio-media; echo STORAGE_S3_ACCESS_KEY_ID=AKIAFICTICIA; echo STORAGE_S3_SECRET_ACCESS_KEY=chave-secreta-ficticia-do-teste; echo STORAGE_PUBLIC_BASE_URL=https://cdn.exemplo.invalid/cardapio-media; }
OFF() { echo COMPOSE_PROFILES=offsite; echo OFFSITE_S3_ENDPOINT=https://s3.backup.exemplo.invalid; echo OFFSITE_S3_BUCKET=vitry-backup; echo OFFSITE_S3_ACCESS_KEY_ID=KEYFICTICIA; echo OFFSITE_S3_SECRET_ACCESS_KEY=segredo-offsite-ficticio; echo OFFSITE_CRYPT_PASSWORD=$S5; echo OFFSITE_CRYPT_SALT=sal-ficticio-0123456789; }
ALR() { echo ALERT_TELEGRAM_BOT_TOKEN=123:abc; echo ALERT_TELEGRAM_CHAT_ID=42; echo ALERT_HEARTBEAT_URL=https://hc.exemplo.invalid/x; }
PRODOK() { base; echo MFA_ENFORCED=true; echo RESEND_API_KEY=re_chave_ficticia_para_o_teste; OFF; ALR; }   # storage: padrão local, nada a preencher
caso "sem --prod: MFA desligada, sem e-mail e APP_VERSION=local são só aviso" 0 "RESEND_API_KEY vazia" "$(base | troca APP_VERSION local)"
ARGS=--prod
caso "--prod: configuração completa passa" 0 "OK:" "$(PRODOK)"
caso "--prod: MFA_ENFORCED ausente reprova" 1 "MFA_ENFORCED não é true" "$(base; echo RESEND_API_KEY=re_chave_ficticia_para_o_teste)"
caso "--prod: MFA_ENFORCED=false reprova" 1 "MFA_ENFORCED não é true" "$(PRODOK | troca MFA_ENFORCED false)"
caso "--prod: APP_VERSION=local reprova" 1 "APP_VERSION=local" "$(PRODOK | troca APP_VERSION local)"
caso "--prod: RESEND_API_KEY vazia reprova" 1 "RESEND_API_KEY vazia" "$(base; echo MFA_ENFORCED=true; echo RESEND_API_KEY=)"
caso "--prod: os três riscos juntos (sem MFA, sem e-mail, APP_VERSION=local) dão 3 erros" 1 "3 erro(s)" "$({ base; OFF; ALR; } | troca APP_VERSION local)"
caso "--prod: storage em DISCO LOCAL (padrão) passa SEM nenhuma variável de S3" 0 "STORAGE_DRIVER=local" "$(PRODOK)"
caso "--prod: STORAGE_DRIVER=local explícito, com https, passa" 0 "OK:" "$(PRODOK; echo STORAGE_DRIVER=local; echo STORAGE_PUBLIC_BASE_URL=https://pedidos.exemplo.invalid/media)"
caso "--prod: local com STORAGE_LOCAL_DIR relativo reprova" 1 "caminho ABSOLUTO" "$(PRODOK; echo STORAGE_DRIVER=local; echo STORAGE_LOCAL_DIR=uploads)"
caso "--prod: local com STORAGE_LOCAL_DIR absoluto mas diferente de /uploads: só aviso" 0 "o compose FIXA /uploads" "$(PRODOK; echo STORAGE_LOCAL_DIR=/dados/fotos)"
caso "--prod: local com URL pública http reprova" 1 "STORAGE_PUBLIC_BASE_URL deve começar com https://" "$(PRODOK; echo STORAGE_PUBLIC_BASE_URL=http://pedidos.exemplo.invalid/media)"
caso "--prod: STORAGE_DRIVER inválido reprova" 1 "STORAGE_DRIVER='ftp' inválido" "$(PRODOK; echo STORAGE_DRIVER=ftp)"
caso "--prod: driver s3 sem nenhuma variável reprova e lista as 5" 1 "faltam STORAGE_S3_ENDPOINT STORAGE_S3_BUCKET STORAGE_S3_ACCESS_KEY_ID STORAGE_S3_SECRET_ACCESS_KEY STORAGE_PUBLIC_BASE_URL" "$(PRODOK; echo STORAGE_DRIVER=s3)"
caso "--prod: driver s3 completo passa" 0 "storage S3 das imagens configurado" "$(PRODOK; echo STORAGE_DRIVER=s3; STORAGE)"
caso "--prod: driver s3 sem só a chave secreta reprova e nomeia a variável" 1 "faltam STORAGE_S3_SECRET_ACCESS_KEY" "$({ PRODOK; echo STORAGE_DRIVER=s3; STORAGE; } | sem STORAGE_S3_SECRET_ACCESS_KEY)"
caso "--prod: driver s3 com URL pública http reprova" 1 "STORAGE_PUBLIC_BASE_URL deve começar com https://" "$({ PRODOK; echo STORAGE_DRIVER=s3; STORAGE; } | troca STORAGE_PUBLIC_BASE_URL http://cdn.exemplo.invalid/x)"
ARGS=
# --- CL-12 cópia off-site e INF-08 alertas
caso "sem --prod: sem off-site e sem alerta são só aviso" 0 "cópia off-site DESLIGADA" "$(base)"
ARGS=--prod
caso "--prod: sem off-site reprova" 1 "cópia off-site DESLIGADA" "$(PRODOK | sem COMPOSE_PROFILES)"
caso "--prod: off-site sem bucket reprova" 1 "OFFSITE_S3_BUCKET vazia" "$(PRODOK | sem OFFSITE_S3_BUCKET)"
caso "--prod: off-site com endpoint http reprova" 1 "OFFSITE_S3_ENDPOINT deve ser https" "$(PRODOK | troca OFFSITE_S3_ENDPOINT http://s3.exemplo.invalid)"
caso "--prod: off-site na AWS dispensa endpoint" 0 "OK:" "$({ PRODOK | sem OFFSITE_S3_ENDPOINT; echo OFFSITE_S3_PROVIDER=AWS; })"
caso "--prod: senha de cifra curta reprova" 1 "OFFSITE_CRYPT_PASSWORD curto" "$(PRODOK | troca OFFSITE_CRYPT_PASSWORD curta123)"
caso "--prod: senha de cifra igual ao sal reprova" 1 "iguais (precisam ser diferentes)" "$(PRODOK | troca OFFSITE_CRYPT_SALT $S5)"
caso "--prod: senha de cifra igual ao JWT_SECRET reprova (sem imprimir o valor)" 1 "OFFSITE_CRYPT_PASSWORD igual a JWT_SECRET" "$(PRODOK | troca OFFSITE_CRYPT_PASSWORD $S1)"
caso "--prod: COMPOSE_PROFILES com outros perfis e offsite passa" 0 "cópia off-site LIGADA" "$(PRODOK | troca COMPOSE_PROFILES 'extra,offsite')"
caso "--prod: sem canal de alerta reprova" 1 "nenhum canal de alerta" "$(PRODOK | sem ALERT_TELEGRAM_BOT_TOKEN | sem ALERT_TELEGRAM_CHAT_ID)"
caso "--prod: só webhook https como canal passa" 0 "alertas com canal" "$({ PRODOK | sem ALERT_TELEGRAM_BOT_TOKEN | sem ALERT_TELEGRAM_CHAT_ID; echo ALERT_WEBHOOK_URL=https://hooks.exemplo.invalid/x; })"
caso "--prod: webhook http reprova" 1 "ALERT_WEBHOOK_URL deve começar com https://" "$(PRODOK; echo ALERT_WEBHOOK_URL=http://hooks.exemplo.invalid/x)"
caso "token do Telegram sem chat reprova" 1 "sem ALERT_TELEGRAM_CHAT_ID" "$(PRODOK | sem ALERT_TELEGRAM_CHAT_ID)"
caso "staging sem off-site: só aviso" 0 "staging (DEPLOY_ENV=staging): sem cópia off-site" "$(PRODOK | sem COMPOSE_PROFILES; echo DEPLOY_ENV=staging)"
caso "staging continua exigindo canal de alerta" 1 "nenhum canal de alerta" "$(PRODOK | sem COMPOSE_PROFILES | sem ALERT_TELEGRAM_BOT_TOKEN | sem ALERT_TELEGRAM_CHAT_ID; echo DEPLOY_ENV=staging)"
caso "DEPLOY_ENV inválido reprova" 1 "DEPLOY_ENV='homolog' inválido" "$(PRODOK; echo DEPLOY_ENV=homolog)"
caso "sem heartbeat: só aviso" 0 "ALERT_HEARTBEAT_URL vazia" "$(PRODOK | sem ALERT_HEARTBEAT_URL)"
ARGS=
caso "sem --prod: driver s3 incompleto é só aviso" 0 "STORAGE_DRIVER=s3 incompleto" "$(base; echo STORAGE_DRIVER=s3)"
caso "local com chave de S3 preenchida: aviso de que é ignorada" 0 "STORAGE_DRIVER=local a ignora" "$(base; echo STORAGE_S3_BUCKET=x)"
# --- API-58: REVALIDATE_SECRET (opcional; forte quando preenchido; distinto dos outros)
caso "REVALIDATE_SECRET vazio: só aviso (o ISR de 30 s atualiza o cardápio)" 0 "REVALIDATE_SECRET vazio" "$(base)"
caso "REVALIDATE_SECRET forte passa" 0 "REVALIDATE_SECRET com 41 caracteres" "$(base; echo REVALIDATE_SECRET=$S5)"
caso "REVALIDATE_SECRET curto reprova mesmo sem --prod" 1 "REVALIDATE_SECRET curto" "$(base; echo REVALIDATE_SECRET=curto123)"
caso "REVALIDATE_SECRET igual a outro segredo reprova" 1 "REVALIDATE_SECRET têm o MESMO valor" "$(base; echo REVALIDATE_SECRET=$S1)"
# --- INF-19/C4: ADMIN_TOKEN fraco reprova sempre; vazio é permitido
caso "ADMIN_TOKEN curto reprova mesmo sem --prod" 1 "ADMIN_TOKEN curto" "$(base; echo ADMIN_TOKEN=curto123)"
caso "ADMIN_TOKEN forte passa" 0 "" "$(base; echo ADMIN_TOKEN=$S5)"
caso "ADMIN_TOKEN vazio passa" 0 "" "$(base; echo ADMIN_TOKEN=)"
# --- NG-08: captcha do pedido público (off | turnstile; as DUAS chaves com turnstile; fake nunca)
caso "captcha desligado (padrão) passa" 0 "CAPTCHA_MODE=off" "$(base)"
caso "captcha turnstile com as duas chaves passa" 0 "NEXT_PUBLIC_TURNSTILE_SITE_KEY preenchida" "$(base; echo CAPTCHA_MODE=turnstile; echo TURNSTILE_SECRET_KEY=0x4AAAsecreta; echo NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAsite)"
caso "captcha turnstile sem a chave secreta reprova" 1 "TURNSTILE_SECRET_KEY vazia" "$(base; echo CAPTCHA_MODE=turnstile; echo NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAsite)"
caso "captcha turnstile sem a chave do site reprova (o cardápio não mostraria o captcha)" 1 "NEXT_PUBLIC_TURNSTILE_SITE_KEY vazia" "$(base; echo CAPTCHA_MODE=turnstile; echo TURNSTILE_SECRET_KEY=0x4AAAsecreta)"
caso "captcha com a chave secreta igual à do site reprova" 1 "a secreta nunca pode ir para o navegador" "$(base; echo CAPTCHA_MODE=turnstile; echo TURNSTILE_SECRET_KEY=0x4AAAmesma; echo NEXT_PUBLIC_TURNSTILE_SITE_KEY=0x4AAAmesma)"
caso "captcha fake reprova" 1 "CAPTCHA_MODE=fake é só para desenvolvimento" "$(base; echo CAPTCHA_MODE=fake)"
caso "captcha com modo desconhecido reprova" 1 "inválido (use off ou turnstile)" "$(base; echo CAPTCHA_MODE=hcaptcha)"
# --- INF-19/C3: .env legível por outros gera aviso (só onde o modo do arquivo é confiável)
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*) echo "  [pulado] modo do .env (Windows: o modo de arquivo não é confiável); testar no Linux" ;;
  *) f="$TMP/perm.env"; base > "$f"; chmod 644 "$f"; out="$(bash "$CHK" "$f" 2>&1)"
     [[ "$out" == *"chmod 600"* ]] && { PASS=$((PASS+1)); echo "  [ok]    .env com modo 644 gera aviso de chmod 600"; } || { FAILS=$((FAILS+1)); echo "  [FALHA] .env 644 sem aviso"; }
     chmod 600 "$f"; out="$(bash "$CHK" "$f" 2>&1)"
     [[ "$out" != *"chmod 600"* ]] && { PASS=$((PASS+1)); echo "  [ok]    .env com modo 600 sem aviso"; } || { FAILS=$((FAILS+1)); echo "  [FALHA] .env 600 com aviso indevido"; } ;;
esac

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
