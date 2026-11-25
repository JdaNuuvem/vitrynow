#!/bin/sh
# Baixa do off-site (decifrando) um dump e seus arquivos para uma pasta local. Não restaura nada no banco:
# depois rode restore-verify.sh no arquivo baixado (RUNBOOK-infra §5c).
#   docker compose --profile offsite run --rm -v "$PWD/restaurar:/restaurar" backup-offsite /bin/sh /scripts/offsite-restore.sh [NOME.dump]
# Sem NOME: lista os dumps disponíveis.
set -eu
. /scripts/offsite-env.sh
if [ -z "${1:-}" ]; then rclone lsf offsite:dumps --include '*.dump' | sort; exit 0; fi
stamp="$(printf '%s' "$1" | sed -n 's/.*_\([0-9]\{8\}_[0-9]\{6\}\)\.dump$/\1/p')"
mkdir -p /restaurar
rclone copy offsite:dumps /restaurar --include "*${stamp}*"
( cd /restaurar && sha256sum -c "$1.sha256" )
echo "baixado e conferido em /restaurar: $(ls /restaurar | tr '\n' ' ')"
