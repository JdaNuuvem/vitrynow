#!/bin/bash
# Valida o infra/.env ANTES de subir a stack (INF-09; o deploy.sh do INF-11 vai chamá-lo). Não executa o arquivo: só lê KEY=VALUE.
# NUNCA imprime valores de segredo: só nomes e tamanhos. Sai com 1 se houver ERRO; AVISO não reprova.
#
#   infra/check-env.sh [--prod] [caminho/do/.env]        (padrão: infra/.env)
#   --prod (INF-19/C2, Nightingale): o que é só AVISO em dev vira ERRO para um servidor real: MFA_ENFORCED != true, APP_VERSION=local e RESEND_API_KEY vazia
#   (sem e-mail não há redefinição de senha nem aviso de tentativa de login). Rode com --prod antes de todo deploy de produção.
#
# Regras que o compose não consegue expressar (`:?` do compose é sempre incondicional):
#  - segredos fortes (32+), todos DIFERENTES entre si, sem valores de exemplo;
#  - URLs https sem barra final; cookie Secure; TRUST_PROXY_CIDR derivado do CADDY_IP (não definir);
#  - PIX por loja (API-07): MP_OAUTH_MODE=off|real (`fake` só em dev). Com `off` nada do PIX é exigido; com `real` exige chave de
#    cifra própria, MP_CLIENT_ID/SECRET e PUBLIC_API_URL https; rotação (PREV/PREV_ID) só em par e diferente da atual.
set -uo pipefail
PROD=0; ARQ=""
for a in "$@"; do case "$a" in --prod) PROD=1 ;; *) ARQ="$a" ;; esac; done
ENVF="${ARQ:-$(dirname "$0")/.env}"
[ -f "$ENVF" ] || { echo "arquivo $ENVF não existe (copie infra/.env.example e preencha)"; exit 2; }

declare -A V
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
  k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
    *) v="${v%% \#*}"; v="${v%"${v##*[![:space:]]}"}" ;;   # comentário no fim da linha (valor sem aspas)
  esac
  V[$k]="$v"
done < "$ENVF"
get() { printf '%s' "${V[$1]:-}"; }

ERR=0; WARN=0
bad()  { echo "  [ERRO]  $*"; ERR=$((ERR+1)); }
warn() { echo "  [aviso] $*"; WARN=$((WARN+1)); }
ok()   { echo "  [ok]    $*"; }
risco() { if [ "$PROD" = 1 ]; then bad "$* (--prod)"; else warn "$*"; fi; }   # aviso em dev, ERRO com --prod

strong() { # NOME [mínimo] -> exige valor com pelo menos N caracteres
  local n="$1" min="${2:-32}" v; v="$(get "$n")"
  if [ -z "$v" ]; then bad "$n está vazio ou ausente"; return 1; fi
  if [ "${#v}" -lt "$min" ]; then bad "$n curto (${#v} caracteres; mínimo $min)"; return 1; fi
  case "$v" in changeme|secret|troque-este-segredo-em-producao|dev-secret-change-me|test-secret-nao-use-em-producao) bad "$n é um valor de exemplo/teste conhecido"; return 1;; esac
  ok "$n com ${#v} caracteres"; return 0
}
https_url() { # NOME -> https://host[:porta], sem caminho nem barra final
  local n="$1" v; v="$(get "$n")"
  if [ -z "$v" ]; then bad "$n está vazio ou ausente"; return 1; fi
  if [[ "$v" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then ok "$n https sem barra final"; else bad "$n deve ser https://dominio[:porta] sem barra final nem caminho (tem ${#v} caracteres)"; return 1; fi
}

echo "== validando $ENVF"
# --- infraestrutura e segredos que sempre existem
pg="$(get POSTGRES_PASSWORD)"
if [[ "$pg" =~ ^[A-Za-z0-9_-]{24,}$ ]]; then ok "POSTGRES_PASSWORD com 24+ caracteres seguros"; else bad "POSTGRES_PASSWORD precisa de 24+ caracteres [A-Za-z0-9_-] (gere com: openssl rand -hex 24); '/', '+', '@' quebram a DATABASE_URL"; fi
strong JWT_SECRET; strong MFA_HMAC_KEY; strong API_INTERNAL_SECRET
for n in DOMAIN ACME_EMAIL APP_VERSION; do [ -n "$(get $n)" ] || bad "$n está vazio ou ausente"; done
https_url WEB_ORIGIN; https_url NEXT_PUBLIC_API_URL
[ "$(get COOKIE_SECURE)" = "false" ] && bad "COOKIE_SECURE=false só vale em teste local sem https"
[[ "$(get CADDY_IP)" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ || -z "$(get CADDY_IP)" ]] || bad "CADDY_IP inválido"
[ -n "$(get TRUST_PROXY_CIDR)" ] && bad "TRUST_PROXY_CIDR não deve ser definido: o compose o deriva de CADDY_IP (mudar só um dos dois reabre o ST-02c)"
[ "$(get APP_VERSION)" = "local" ] && risco "APP_VERSION=local: sem versão fixa não há como voltar para a imagem anterior"
# LGPD (ADR-0014, API-52b): as ações de privacidade só ligam em produção com a confirmação jurídica explícita (parecer P1-P17)
[ "$(get PRIVACY_ACTIONS_ENABLED)" = "true" ] && [ "$(get PRIVACY_ACTIONS_LEGAL_OK)" != "true" ] && bad "PRIVACY_ACTIONS_ENABLED=true exige PRIVACY_ACTIONS_LEGAL_OK=true (parecer jurídico LGPD); sem ele, deixe desligada"
PHS="$(get PRIVACY_HASH_SALT)"
[ "$(get PRIVACY_ACTIONS_ENABLED)" = "true" ] && [ "${#PHS}" -lt 16 ] && bad "PRIVACY_ACTIONS_ENABLED=true exige PRIVACY_HASH_SALT (16+ caracteres, segredo; sem ele a lista de não contatar não funciona)"
[ "$(get MFA_ENFORCED)" != "true" ] && risco "MFA_ENFORCED não é true: ligue antes do primeiro cliente real (SEC-13; em produção a API nem sobe sem isso)"
[ -z "$(get RESEND_API_KEY)" ] && risco "RESEND_API_KEY vazia: a API não envia e-mail (redefinição de senha e aviso de tentativas de login ficam mudos)"
# C4 (Nightingale): ADMIN_TOKEN é opcional, mas se preenchido precisa ser forte (protege as rotas /api/admin, só por túnel)
AT="$(get ADMIN_TOKEN)"; [ -n "$AT" ] && [ "${#AT}" -lt 32 ] && bad "ADMIN_TOKEN curto (${#AT} caracteres; mínimo 32 quando preenchido)"
# C3 (Nightingale): o .env guarda todos os segredos; não pode ser legível por outros usuários do servidor (só onde o modo de arquivo é confiável: não em Windows)
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*) : ;;
  *) modo="$(stat -c %a "$ENVF" 2>/dev/null || true)"
     if [ -n "$modo" ] && [[ ! "$modo" =~ ^[0-7]?[0-7]00$ ]]; then warn "$ENVF com modo $modo: outros usuários do servidor conseguem ler os segredos (chmod 600 $ENVF)"; fi ;;
esac

# --- storage das imagens (API-18, ADR-0017): padrão do compose = disco local. Com local NÃO exige S3; com s3 exige as 5 variáveis (a API recusa subir sem elas)
drv="$(get STORAGE_DRIVER)"; drv="${drv:-local}"
case "$drv" in
  local) ok "STORAGE_DRIVER=local: fotos em disco (volume uploads_data); nenhuma variável de S3 é exigida"
         ld="$(get STORAGE_LOCAL_DIR)"
         if [ -n "$ld" ]; then
           [[ "$ld" == /* ]] || bad "STORAGE_LOCAL_DIR deve ser um caminho ABSOLUTO (tem ${#ld} caracteres)"
           [ "$ld" = /uploads ] || warn "STORAGE_LOCAL_DIR difere de /uploads: o compose FIXA /uploads (é onde o volume está montado); o valor do .env é ignorado"
         fi
         pb="$(get STORAGE_PUBLIC_BASE_URL)"
         [ -z "$pb" ] || [[ "$pb" =~ ^https:// ]] || bad "STORAGE_PUBLIC_BASE_URL deve começar com https:// (a API recusa subir com outro valor); vazia = WEB_ORIGIN/media"
         for n in STORAGE_S3_ENDPOINT STORAGE_S3_BUCKET STORAGE_S3_ACCESS_KEY_ID STORAGE_S3_SECRET_ACCESS_KEY; do [ -n "$(get $n)" ] && warn "$n está preenchida mas STORAGE_DRIVER=local a ignora"; done ;;
  s3)    falt=""; for n in STORAGE_S3_ENDPOINT STORAGE_S3_BUCKET STORAGE_S3_ACCESS_KEY_ID STORAGE_S3_SECRET_ACCESS_KEY STORAGE_PUBLIC_BASE_URL; do [ -n "$(get $n)" ] || falt="$falt $n"; done
         if [ -n "$falt" ]; then risco "STORAGE_DRIVER=s3 incompleto: faltam$falt (a API NÃO sobe em produção sem elas)"; else
           ok "storage S3 das imagens configurado (5 variáveis)"
           [[ "$(get STORAGE_PUBLIC_BASE_URL)" =~ ^https:// ]] || bad "STORAGE_PUBLIC_BASE_URL deve começar com https:// (a API recusa subir com outro valor)"
         fi ;;
  *)     bad "STORAGE_DRIVER='$drv' inválido (use local ou s3)" ;;
esac

# --- PIX por loja (API-07)
mode="$(get MP_OAUTH_MODE)"; mode="${mode:-off}"
case "$mode" in
  off)  ok "MP_OAUTH_MODE=off: PIX por loja desligado; nenhuma variável do PIX é exigida"
        for n in PAYMENT_ENC_KEY MP_CLIENT_ID MP_CLIENT_SECRET PUBLIC_API_URL; do [ -n "$(get $n)" ] && warn "$n está preenchida mas MP_OAUTH_MODE=off a ignora"; done ;;
  real) ok "MP_OAUTH_MODE=real: validando o grupo do PIX por loja"
        strong PAYMENT_ENC_KEY 32
        kid="$(get PAYMENT_ENC_KEY_ID)"; kid="${kid:-v1}"
        [[ "$kid" =~ ^[A-Za-z0-9_-]{1,16}$ ]] && ok "PAYMENT_ENC_KEY_ID=$kid" || bad "PAYMENT_ENC_KEY_ID inválido (use [A-Za-z0-9_-], até 16 caracteres)"
        [ -n "$(get MP_CLIENT_ID)" ] && ok "MP_CLIENT_ID preenchido" || bad "MP_CLIENT_ID está vazio (obrigatório com MP_OAUTH_MODE=real)"
        strong MP_CLIENT_SECRET 8
        https_url PUBLIC_API_URL
        prev="$(get PAYMENT_ENC_KEY_PREV)"; pid="$(get PAYMENT_ENC_KEY_PREV_ID)"
        if [ -n "$prev$pid" ]; then
          if [ -z "$prev" ] || [ -z "$pid" ]; then bad "rotação: PAYMENT_ENC_KEY_PREV e PAYMENT_ENC_KEY_PREV_ID só valem em PAR (um está vazio)"
          else
            [ "${#prev}" -ge 32 ] || bad "PAYMENT_ENC_KEY_PREV curta (${#prev}; mínimo 32)"
            [ "$prev" != "$(get PAYMENT_ENC_KEY)" ] || bad "PAYMENT_ENC_KEY_PREV é igual à atual: a rotação não troca nada"
            [ "$pid" != "$kid" ] || bad "PAYMENT_ENC_KEY_PREV_ID é igual a PAYMENT_ENC_KEY_ID: a API não distingue as duas chaves"
            warn "rotação de chave do PIX em andamento: depois de re-cifrar tudo, esvazie PAYMENT_ENC_KEY_PREV e PAYMENT_ENC_KEY_PREV_ID (veja docs/RUNBOOK-infra.md)"
          fi
        fi ;;
  fake) bad "MP_OAUTH_MODE=fake é só para desenvolvimento/teste (a API recusa subir fora disso)" ;;
  *)    bad "MP_OAUTH_MODE='$mode' inválido (use off ou real)" ;;
esac

# --- nenhum segredo repetido entre si (compara valores, imprime só nomes)
names=(POSTGRES_PASSWORD JWT_SECRET MFA_HMAC_KEY API_INTERNAL_SECRET)
[ "$mode" = real ] && names+=(PAYMENT_ENC_KEY)
dup=0
for ((i=0; i<${#names[@]}; i++)); do for ((j=i+1; j<${#names[@]}; j++)); do
  a="$(get "${names[$i]}")"; b="$(get "${names[$j]}")"
  if [ -n "$a" ] && [ "$a" = "$b" ]; then bad "${names[$i]} e ${names[$j]} têm o MESMO valor (cada segredo precisa ser diferente)"; dup=1; fi
done; done
[ "$dup" = 0 ] && ok "segredos distintos entre si"

echo
if [ "$ERR" -gt 0 ]; then echo "$ERR erro(s), $WARN aviso(s) em $ENVF; nada foi alterado."; exit 1; fi
echo "OK: $ENVF válido ($WARN aviso(s))."
