#!/bin/bash
# Roda TODOS os testes de shell da infra (sem Docker real, sem rede). Em Windows sem bash, dentro de um container:
#   docker run --rm -v "$PWD:/w" -w /w bash:5.2 bash scripts/run-infra-tests.sh
[ -e /bin/bash ] || ln -sf "$(command -v bash)" /bin/bash   # imagem bash:* tem o bash em /usr/local/bin
command -v apk >/dev/null && apk add -q coreutils grep sed >/dev/null 2>&1
cd "$(dirname "$0")/.."
falhou=0
for t in check-env saude alerta deploy; do
  printf '%-10s ' "$t:"; out="$(bash "scripts/test-$t.sh" 2>&1)"; rc=$?
  echo "$out" | tail -1
  if [ "$rc" != 0 ]; then falhou=1; echo "$out" | grep -A8 FALHA | head -30; fi
done
exit "$falhou"
