#!/bin/sh
# Saudável = a última cópia off-site conferida tem menos de 2x o intervalo do backup local + 2 h de folga.
set -eu
STATE_DIR="${STATE_DIR:-/state}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
[ -s "$STATE_DIR/OFFSITE_LAST_OK" ] || { echo "nenhuma cópia off-site conferida ainda"; exit 1; }
LAST="$(cut -d' ' -f1 "$STATE_DIR/OFFSITE_LAST_OK")"
AGE=$(( $(date -u +%s) - LAST ))
MAX=$(( 2 * INTERVAL + 7200 ))
[ "$AGE" -le "$MAX" ] || { echo "última cópia off-site tem ${AGE}s (limite ${MAX}s)"; exit 1; }
