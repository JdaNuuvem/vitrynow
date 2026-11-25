#!/bin/sh
# Cópia OFF-SITE dos backups (CL-12): leva para fora do servidor os dumps e as fotos que o postgres-backup já VERIFICOU.
# Roda no serviço backup-offsite (imagem rclone, perfil "offsite" do compose). Destino = qualquer S3 compatível
# (Backblaze B2, Cloudflare R2, Wasabi, AWS...). Os arquivos sobem CRIPTOGRAFADOS no cliente (rclone crypt): o provedor
# nunca vê dado de cliente nem hash de senha. Sem a senha OFFSITE_CRYPT_PASSWORD o backup off-site é ilegível — guarde-a
# FORA do servidor (cofre de senhas do dono). Perder a senha = perder a cópia.
#
# Ciclo: a cada OFFSITE_CHECK_SECONDS, se LAST_OK (backup local verificado) mudou desde o último envio:
#   1) envia o dump + .sha256 (+ fotos do mesmo carimbo) para offsite:  2) confere com `rclone cryptcheck` (hash do conteúdo
#   cifrado no destino x arquivo local)  3) só então grava /state/OFFSITE_LAST_OK  4) retenção remota (OFFSITE_KEEP_DAYS,
#   nunca apaga os OFFSITE_KEEP_MIN mais recentes). Falha = não avança o marcador; o healthcheck e o saude.sh acusam.
set -u
BACKUP_DIR="${BACKUP_DIR:-/backups}"
STATE_DIR="${STATE_DIR:-/state}"
CHECK="${OFFSITE_CHECK_SECONDS:-600}"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"
KEEP_MIN="${OFFSITE_KEEP_MIN:-7}"
log() { printf '%s offsite: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
. "$(dirname "$0")/offsite-env.sh"
mkdir -p "$STATE_DIR"

envia() { # $1 = nome do dump verificado (ex.: meucardapio_20261124_030000.dump)
  dump="$1"; stamp="$(printf '%s' "$dump" | sed -n 's/.*_\([0-9]\{8\}_[0-9]\{6\}\)\.dump$/\1/p')"
  [ -f "$BACKUP_DIR/$dump" ] || { log "FALHA: $dump citado no LAST_OK não existe"; return 1; }
  lista="$STATE_DIR/files.txt"; : > "$lista"
  for f in "$dump" "$dump.sha256"; do echo "$f" >> "$lista"; done
  [ -n "$stamp" ] && ( cd "$BACKUP_DIR" && ls -1 2>/dev/null | grep -F "$stamp" | grep -v -e '\.partial$' -e "^$dump" ) >> "$lista"
  rclone copy --files-from "$lista" --no-traverse "$BACKUP_DIR" offsite:dumps || { log "FALHA: envio de $dump"; return 1; }
  rclone cryptcheck --one-way --files-from "$lista" "$BACKUP_DIR" offsite:dumps || { log "FALHA: conferência (cryptcheck) de $dump"; return 1; }
  # retenção remota: mantém sempre os KEEP_MIN dumps mais novos
  total="$(rclone lsf offsite:dumps --include '*.dump' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${total:-0}" -gt "$KEEP_MIN" ]; then
    rclone delete offsite:dumps --min-age "${KEEP_DAYS}d" --include '*.dump' --include '*.sha256' --include '*.tar*' --include '*.manifest' 2>&1 | tail -3
    rest="$(rclone lsf offsite:dumps --include '*.dump' 2>/dev/null | wc -l | tr -d ' ')"
    [ "${rest:-0}" -ge "$KEEP_MIN" ] || log "aviso: retenção deixou ${rest} dump(s) (mínimo $KEEP_MIN): confira o relógio do servidor"
  fi
  printf '%s %s\n' "$(date -u +%s)" "$dump" > "$STATE_DIR/OFFSITE_LAST_OK"
  log "ok $dump ($(wc -l < "$lista" | tr -d ' ') arquivo(s)) enviado e conferido"
}

[ "${1:-}" = "--once" ] && ONCE=1 || ONCE=0
while true; do
  if [ -s "$BACKUP_DIR/LAST_OK" ]; then
    dump="$(cut -d' ' -f2 "$BACKUP_DIR/LAST_OK")"
    feito="$(cut -d' ' -f2 "$STATE_DIR/OFFSITE_LAST_OK" 2>/dev/null)"
    if [ "$dump" != "$feito" ]; then envia "$dump" || [ "$ONCE" = 0 ] || exit 1; fi
  else
    log "aguardando o primeiro backup local verificado (LAST_OK)"
  fi
  [ "$ONCE" = 1 ] && exit 0
  sleep "$CHECK"
done
