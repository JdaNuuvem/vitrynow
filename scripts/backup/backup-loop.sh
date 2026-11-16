#!/bin/sh
# Laço do serviço postgres-backup: roda backup.sh agora e a cada BACKUP_INTERVAL_SECONDS.
# Uma falha NÃO derruba o laço (tenta de novo no próximo ciclo), mas o healthcheck
# (healthcheck.sh) passa a reportar "unhealthy" porque LAST_OK deixa de avançar.
BACKUP_INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_RETRY_SECONDS="${BACKUP_RETRY_SECONDS:-300}"   # após falha, tenta de novo logo (não espera o ciclo inteiro)
while true; do
  if /bin/sh /scripts/backup.sh; then
    sleep "$BACKUP_INTERVAL_SECONDS"
  else
    echo "backup-loop: ciclo falhou, nova tentativa em ${BACKUP_RETRY_SECONDS}s"
    sleep "$BACKUP_RETRY_SECONDS"
  fi
done
