#!/bin/sh
# Backup VERIFICADO da pasta de uploads (fotos do cardápio em disco local; decisão do Claudio 18/11, sem S3/R2). Chamado por backup.sh com o MESMO carimbo do dump.
#
#   backup-uploads.sh <CARIMBO>        (UPLOADS_DIR padrão /uploads, BACKUP_DIR padrão /backups, KEEP_DAYS 14, KEEP_MIN 3)
#
# Gera uploads_<CARIMBO>.tar.gz + .tar.gz.sha256 + uploads_<CARIMBO>.manifest (sha256 de CADA arquivo, lido do que está DENTRO do tar, não da pasta viva:
# um arquivo gravado durante o backup não gera falso erro). Um backup só "existe" se o tar foi relido e o manifesto fechou; senão exit 1 e nada fica.
# A pasta quarantine/ (originais de vídeo em conversão) é EXCLUÍDA do backup.
# Pasta de uploads ausente = ERRO (volume não montado: o backup passaria "ok" sem foto nenhuma). Pasta vazia é válida (loja sem fotos ainda).
set -eu
umask 077
UPLOADS_DIR="${UPLOADS_DIR:-/uploads}"; BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"; KEEP_MIN="${KEEP_MIN:-3}"
STAMP="${1:?uso: backup-uploads.sh <carimbo>}"
log() { printf '%s backup-uploads: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
FINAL="$BACKUP_DIR/uploads_${STAMP}.tar.gz"; TMP="$FINAL.partial"; CHK="$BACKUP_DIR/.verif_uploads_$$"
limpa() { rm -rf "$TMP" "$TMP.manifest" "$CHK"; }
fail() { log "FALHA: $*"; limpa; exit 1; }
trap 'rm -rf "$CHK"' EXIT

[ -d "$UPLOADS_DIR" ] || fail "pasta de uploads $UPLOADS_DIR não existe (volume não montado?)"
mkdir -p "$BACKUP_DIR"

# quarantine/ (ADR-0021, Reels) guarda o ORIGINAL CRU enviado pelo cliente por minutos, até a conversão: nunca vai para o backup (seria reter por 14 dias o que a decisão manda apagar
# ao fim do job, e é dado pessoal sem validação). O que fica é o MP4 final e a capa, sob stores/<loja>/reels/.
tar -czf "$TMP" -C "$UPLOADS_DIR" --exclude=./quarantine . 2>/dev/null || fail "tar falhou"
[ -s "$TMP" ] || fail "arquivo vazio"
# verificação: relê o tar numa pasta temporária e gera o manifesto do que REALMENTE foi arquivado
mkdir -p "$CHK"
tar -xzf "$TMP" -C "$CHK" 2>/dev/null || fail "o tar gerado não pode ser relido"
( cd "$CHK" && find . -type f | sort | while IFS= read -r f; do sha256sum "$f"; done ) > "$TMP.manifest" || fail "não consegui gerar o manifesto"
NARQ="$(wc -l < "$TMP.manifest" | tr -d ' ')"
rm -rf "$CHK"
# publicação atômica: selo do tar, manifesto, depois o tar
( cd "$BACKUP_DIR" && sha256sum "$(basename "$TMP")" | sed "s/$(basename "$TMP")/$(basename "$FINAL")/" > "$(basename "$FINAL").sha256" )
mv "$TMP.manifest" "$BACKUP_DIR/uploads_${STAMP}.manifest"
mv "$TMP" "$FINAL"
log "ok $(basename "$FINAL") $(wc -c < "$FINAL" | tr -d ' ') bytes, $NARQ arquivo(s)"

# retenção, só depois de um backup bom: mantém sempre os KEEP_MIN mais recentes
COUNT="$(ls -1 "$BACKUP_DIR"/uploads_*.tar.gz 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT" -gt "$KEEP_MIN" ]; then
  REMOVABLE=$((COUNT - KEEP_MIN))
  for f in $(find "$BACKUP_DIR" -maxdepth 1 -name 'uploads_*.tar.gz' -mtime +"$KEEP_DAYS" | sort); do
    [ "$REMOVABLE" -gt 0 ] || break
    b="${f%.tar.gz}"; rm -f "$f" "$f.sha256" "$b.manifest"; REMOVABLE=$((REMOVABLE - 1)); log "retenção: removido $(basename "$f")"
  done
fi
