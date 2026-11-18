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
  local out rc; out="$(bash "$CHK" "$f" 2>&1)"; rc=$?
  if [ "$rc" = "$want" ] && { [ -z "$frag" ] || [[ "$out" == *"$frag"* ]]; }; then PASS=$((PASS+1)); echo "  [ok]    $desc"
  else FAILS=$((FAILS+1)); echo "  [FALHA] $desc (exit=$rc, esperado $want, trecho '$frag')"; echo "$out" | sed 's/^/          /' | head -12; fi
  # segurança: nenhum valor de segredo pode aparecer na saída
  for s in "$S1" "$S2" "$S3" "$S4" "$S5" "$PG" "segredo-do-painel-mp"; do
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

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
