#!/bin/sh
# Saudável = existe um backup verificado (LAST_OK) mais novo que 2x o intervalo + folga de 1h.
set -eu
BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
[ -s "$BACKUP_DIR/LAST_OK" ] || { echo "nenhum backup verificado ainda"; exit 1; }
LAST="$(cut -d' ' -f1 "$BACKUP_DIR/LAST_OK")"
AGE=$(( $(date -u +%s) - LAST ))
MAX=$(( 2 * INTERVAL + 3600 ))
[ "$AGE" -le "$MAX" ] || { echo "último backup bom tem ${AGE}s (limite ${MAX}s)"; exit 1; }
