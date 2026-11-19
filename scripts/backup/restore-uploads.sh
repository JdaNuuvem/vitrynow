#!/bin/sh
# Restaura e VERIFICA um backup de uploads (o par de backup-uploads.sh) numa pasta NOVA ou vazia.
#
#   restore-uploads.sh <uploads_CARIMBO.tar.gz> <pasta-destino>
#
# Recusa: selo sha256 ausente ou diferente; tar com caminho absoluto ou com ".." (path traversal); destino com arquivos (nunca sobrescreve);
# manifesto diferente do que foi extraído. Não toca no volume de produção: extraia numa pasta temporária, confira e SÓ ENTÃO copie para o volume
# (veja docs/RUNBOOK-infra.md, restauração de uploads). Sai 0 só se tudo fechou.
set -eu
umask 077
TAR="${1:?uso: restore-uploads.sh <uploads_X.tar.gz> <pasta-destino>}"; DEST="${2:?falta a pasta de destino}"
log() { printf 'restore-uploads: %s\n' "$*"; }
fail() { log "FALHA: $*"; exit 1; }
[ -f "$TAR" ] || fail "$TAR não existe"
SEL="$TAR.sha256"; MAN="${TAR%.tar.gz}.manifest"
[ -f "$SEL" ] || fail "sem o selo $SEL"
[ -f "$MAN" ] || fail "sem o manifesto $MAN"
( cd "$(dirname "$TAR")" && sha256sum -c "$(basename "$SEL")" >/dev/null 2>&1 ) || fail "sha256 do tar não confere (arquivo alterado ou truncado)"
# path traversal: nada de caminho absoluto nem segmento ".."
if tar -tzf "$TAR" 2>/dev/null | grep -qE '^/|(^|/)\.\.(/|$)'; then fail "o tar tem caminho absoluto ou '..' (recusado)"; fi
mkdir -p "$DEST"
[ -z "$(ls -A "$DEST" 2>/dev/null)" ] || fail "destino $DEST não está vazio (não sobrescrevo)"
tar -xzf "$TAR" -C "$DEST" 2>/dev/null || fail "tar não extraiu"
( cd "$DEST" && sha256sum -c "$(cd "$(dirname "$MAN")" && pwd)/$(basename "$MAN")" >/dev/null 2>&1 ) || fail "o conteúdo extraído não fecha com o manifesto"
EXTR="$(cd "$DEST" && find . -type f | wc -l | tr -d ' ')"; ESPER="$(wc -l < "$MAN" | tr -d ' ')"
[ "$EXTR" = "$ESPER" ] || fail "extraiu $EXTR arquivo(s), o manifesto lista $ESPER"
log "ok: $EXTR arquivo(s) restaurados em $DEST e conferidos contra o manifesto"
