#!/bin/bash
# Teste da regra de carimbo (scripts/migrations-check/stamps.sh). Sem Docker, roda em < 1 s.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/migrations-check/stamps.sh"
PASS=0; FAILS=0
expect() { # descrição  esperado_exit  saida_deve_conter  -- argumentos de stamp_problems
  local desc="$1" want="$2" frag="$3"; shift 4
  local out rc; out="$(stamp_problems "$@")"; rc=$?
  if [ "$rc" = "$want" ] && { [ -z "$frag" ] || [[ "$out" == *"$frag"* ]]; }; then PASS=$((PASS+1)); echo "  [ok]    $desc"
  else FAILS=$((FAILS+1)); echo "  [FALHA] $desc (exit=$rc, esperado $want; saída: $out)"; fi
}
B1=20261116200000_store_counter; B2=20261116200000_user_token_version; B3=20261117000500_payment_idempotency_key
LAST="$B3"; BASE=("$B1" "$B2" "$B3")

expect "carimbo novo, posterior e único passa"                    0 ""                   -- "$LAST" "${BASE[@]}" -- 20261117010000_revoked_session
expect "duplicata que já existe só na base não é acusada"         0 ""                   -- "$LAST" "${BASE[@]}" -- 20261117010000_revoked_session
expect "novo com o MESMO carimbo de uma migração da base falha"   1 "carimbo repetido"   -- "$LAST" "${BASE[@]}" -- 20261117000500_outra_coisa
expect "duas novas com o mesmo carimbo (SEC-19 x API-12) falham"   2 "carimbo repetido"   -- "$LAST" "${BASE[@]}" -- 20261117010000_revoked_session 20261117010000_print_job
expect "novo ANTES da última da base falha (decrescente)"          1 "carimbo decrescente" -- "$LAST" "${BASE[@]}" -- 20261116233500_payment_idempotency_key
expect "repetido com 2 migrações E decrescente = 3 falhas"          3 ""                   -- "$LAST" "${BASE[@]}" -- 20261116200000_terceira
ALLOW_OUT_OF_ORDER=1 expect "ALLOW_OUT_OF_ORDER=1 rebaixa decrescente a aviso" 0 "AVISO carimbo decrescente" -- "$LAST" "${BASE[@]}" -- 20261116233500_payment_idempotency_key
ALLOW_OUT_OF_ORDER=1 expect "ALLOW_OUT_OF_ORDER=1 NÃO perdoa carimbo repetido"  1 "carimbo repetido"          -- "$LAST" "${BASE[@]}" -- 20261117000500_outra_coisa
expect "nenhuma migração nova: nada a acusar"                      0 ""                   -- "$LAST" "${BASE[@]}" --

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
