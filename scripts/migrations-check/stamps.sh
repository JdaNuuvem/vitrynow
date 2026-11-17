#!/bin/bash
# Regra de carimbo de migração (BOARD §0): "único e crescente". Funções puras, sem Docker, testadas por
# scripts/test-stamps.sh e usadas por scripts/check-migrations.sh.
#
# stamp_problems <ultima_da_base> <nome_base...> -- <nome_novo...>
#   imprime uma linha por problema ("FALHA ..." ou "AVISO ...") e sai com o número de FALHAS:
#   - FALHA carimbo repetido: uma migração NOVA tem o mesmo carimbo (14 primeiros dígitos) que outra, da base ou nova.
#     (Duplicatas que já existem só na base, ex. as duas 20261116200000, são histórico e não são acusadas.)
#   - FALHA carimbo decrescente: uma migração NOVA ordena ANTES da última migração da base. Muda a ordem física das
#     colunas entre banco novo e banco incremental. ALLOW_OUT_OF_ORDER=1 rebaixa para AVISO (reproduzir histórico).
stamp_of() { printf '%s' "${1:0:14}"; }

stamp_problems() {
  local last="$1"; shift
  local base=() new=() mode=base x
  for x in "$@"; do
    if [ "$x" = "--" ]; then mode=new; continue; fi
    if [ "$mode" = base ]; then base+=("$x"); else new+=("$x"); fi
  done
  local fails=0 n m
  for n in "${new[@]}"; do
    for m in "${base[@]}" "${new[@]}"; do
      [ "$m" = "$n" ] && continue
      if [ "$(stamp_of "$n")" = "$(stamp_of "$m")" ]; then
        echo "FALHA carimbo repetido: $n e $m usam o mesmo carimbo $(stamp_of "$n") (regra: único e crescente)"
        fails=$((fails + 1))
      fi
    done
    if [[ "$(stamp_of "$n")" < "$(stamp_of "$last")" ]]; then   # só o carimbo: igual é "repetido", não "decrescente"
      if [ "${ALLOW_OUT_OF_ORDER:-0}" = 1 ]; then
        echo "AVISO carimbo decrescente (permitido por ALLOW_OUT_OF_ORDER=1): $n ordena antes de $last"
      else
        echo "FALHA carimbo decrescente: $n ordena ANTES da última migração da base ($last); renomeie com carimbo posterior"
        fails=$((fails + 1))
      fi
    fi
  done
  return "$fails"
}
