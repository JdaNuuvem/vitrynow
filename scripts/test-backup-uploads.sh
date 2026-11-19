#!/bin/sh
# Teste de backup-uploads.sh + restore-uploads.sh (uploads em disco local). Sem Postgres, sem rede. Feito para rodar num Alpine (busybox), como o serviço
# postgres-backup:  docker run --rm -v "<repo>/scripts:/s:ro" alpine sh /s/test-backup-uploads.sh      (também roda em qualquer Linux)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; BK="$HERE/backup/backup-uploads.sh"; RS="$HERE/backup/restore-uploads.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PASS=0; FAILS=0
ok()  { PASS=$((PASS+1)); echo "  [ok]    $1"; }
bad() { FAILS=$((FAILS+1)); echo "  [FALHA] $1"; }
caso() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

U="$TMP/uploads"; B="$TMP/backups"; mkdir -p "$U/stores/lojaA" "$U/stores/lojaB" "$B"
UUID1="11111111-1111-4111-8111-111111111111"; UUID2="22222222-2222-4222-8222-222222222222"
printf 'imagem-A-1' > "$U/stores/lojaA/$UUID1-40.webp"; printf 'imagem-B-1' > "$U/stores/lojaB/$UUID2-320.webp"
printf 'nome com espaco' > "$U/stores/lojaA/arquivo com espaco.webp"
bk() { UPLOADS_DIR="$U" BACKUP_DIR="$B" sh "$BK" "$@" 2>&1; }

echo "== backup"
OUT="$(bk 20261118_100000)"; RC=$?
caso "backup sai 0 e diz '3 arquivo(s)'" '[ "$RC" = 0 ] && echo "$OUT" | grep -q "3 arquivo(s)"'
caso "gera tar.gz, selo sha256 e manifesto com o MESMO carimbo" '[ -s "$B/uploads_20261118_100000.tar.gz" ] && [ -s "$B/uploads_20261118_100000.tar.gz.sha256" ] && [ -s "$B/uploads_20261118_100000.manifest" ]'
caso "o manifesto tem 1 linha por arquivo (3), com espaço no nome" '[ "$(wc -l < "$B/uploads_20261118_100000.manifest" | tr -d " ")" = 3 ] && grep -q "arquivo com espaco.webp" "$B/uploads_20261118_100000.manifest"'
caso "não deixa .partial nem pasta de verificação" '[ -z "$(ls -A "$B" | grep -E "partial|verif")" ]'
caso "arquivos de backup só para o dono (modo 600)" 'm="$(stat -c %a "$B/uploads_20261118_100000.tar.gz" 2>/dev/null || echo 600)"; [ "$m" = 600 ]'
UPLOADS_DIR="$TMP/nao-existe" BACKUP_DIR="$B" sh "$BK" 20261118_100100 >/dev/null 2>&1; RC=$?
caso "pasta de uploads ausente (volume não montado): exit 1 e nenhum arquivo novo" '[ "$RC" = 1 ] && [ ! -e "$B/uploads_20261118_100100.tar.gz" ]'
E="$TMP/vazia"; mkdir -p "$E"; UPLOADS_DIR="$E" BACKUP_DIR="$B" sh "$BK" 20261118_100200 >/dev/null 2>&1; RC=$?
caso "pasta VAZIA é válida (loja sem fotos): exit 0, manifesto vazio" '[ "$RC" = 0 ] && [ -f "$B/uploads_20261118_100200.manifest" ] && [ ! -s "$B/uploads_20261118_100200.manifest" ]'

echo "== restauração"
R="$TMP/restaurado"
OUT="$(sh "$RS" "$B/uploads_20261118_100000.tar.gz" "$R" 2>&1)"; RC=$?
caso "restaura em pasta nova, exit 0, confere o manifesto" '[ "$RC" = 0 ] && echo "$OUT" | grep -q "3 arquivo(s) restaurados"'
caso "o restaurado é IDÊNTICO ao original (diff -r)" 'diff -r "$U" "$R" >/dev/null 2>&1'
caso "recusa destino com arquivos (não sobrescreve)" 'sh "$RS" "$B/uploads_20261118_100000.tar.gz" "$R" >/dev/null 2>&1; [ $? = 1 ]'
cp "$B/uploads_20261118_100000.tar.gz" "$TMP/corr.tar.gz"; cp "$B/uploads_20261118_100000.tar.gz.sha256" "$TMP/corr.tar.gz.sha256"; cp "$B/uploads_20261118_100000.manifest" "$TMP/corr.manifest"
printf 'x' >> "$TMP/corr.tar.gz"
caso "tar adulterado (sha256 não confere): recusado" 'sh "$RS" "$TMP/corr.tar.gz" "$TMP/d1" >/dev/null 2>&1; [ $? = 1 ] && [ ! -e "$TMP/d1/stores" ]'
rm -f "$TMP/corr.tar.gz.sha256"
caso "sem o selo sha256: recusado" 'sh "$RS" "$TMP/corr.tar.gz" "$TMP/d2" >/dev/null 2>&1; [ $? = 1 ]'
# manifesto que não bate com o conteúdo (alguém troca um arquivo e refaz o selo do tar, mas não o manifesto)
M="$TMP/m"; mkdir -p "$M/stores/lojaA"; printf 'OUTRO-CONTEUDO' > "$M/stores/lojaA/$UUID1-40.webp"
( cd "$M" && tar -czf "$TMP/troca.tar.gz" . ) && ( cd "$TMP" && sha256sum troca.tar.gz > troca.tar.gz.sha256 ) && cp "$B/uploads_20261118_100000.manifest" "$TMP/troca.manifest"
caso "conteúdo que não fecha com o manifesto: recusado" 'sh "$RS" "$TMP/troca.tar.gz" "$TMP/d3" >/dev/null 2>&1; [ $? = 1 ]'
# path traversal: precisa de GNU tar para FABRICAR o tar malicioso (o tar do busybox remove os ".." ao criar; sem GNU tar o caso é PULADO, não aprovado em silêncio)
if tar --version 2>/dev/null | grep -q GNU; then
  T="$TMP/t"; mkdir -p "$T/in"; printf 'x' > "$T/in/ok.webp"
  ( cd "$T/in" && tar -czf "$TMP/trav.tar.gz" --transform='s|^ok.webp|../escapou.webp|' ok.webp ) ; ( cd "$TMP" && sha256sum trav.tar.gz > trav.tar.gz.sha256 ); : > "$TMP/trav.manifest"
  caso "(controle) o tar de teste TEM '..' na listagem" 'tar -tzf "$TMP/trav.tar.gz" | grep -q "^../escapou.webp"'
  caso "tar com '..' no caminho: recusado pela guarda de traversal e nada escrito fora do destino" 'OUT="$(sh "$RS" "$TMP/trav.tar.gz" "$TMP/d4" 2>&1)"; [ $? = 1 ] && echo "$OUT" | grep -q "caminho absoluto ou ...." && [ ! -e "$TMP/escapou.webp" ]'
  ( cd "$T/in" && tar -czf "$TMP/abs.tar.gz" -P --transform='s|^ok.webp|/tmp/escapou-abs.webp|' ok.webp ); ( cd "$TMP" && sha256sum abs.tar.gz > abs.tar.gz.sha256 ); : > "$TMP/abs.manifest"
  caso "tar com caminho ABSOLUTO: recusado" 'OUT="$(sh "$RS" "$TMP/abs.tar.gz" "$TMP/d5" 2>&1)"; [ $? = 1 ] && echo "$OUT" | grep -q "caminho absoluto" && [ ! -e /tmp/escapou-abs.webp ]'
else
  echo "  [pulado] traversal: precisa de GNU tar para fabricar o tar malicioso (rode também num Debian: docker run --rm -v <repo>/scripts:/s:ro debian sh /s/test-backup-uploads.sh)"
fi

echo "== retenção"
RB="$TMP/ret"; mkdir -p "$RB"
for s in 20260101_000000 20260102_000000 20260103_000000 20260104_000000 20260105_000000; do
  UPLOADS_DIR="$U" BACKUP_DIR="$RB" KEEP_DAYS=0 KEEP_MIN=3 sh "$BK" "$s" >/dev/null 2>&1
  touch -d "2026-01-01" "$RB/uploads_$s.tar.gz" 2>/dev/null || touch -t 202601010000 "$RB/uploads_$s.tar.gz"
done
UPLOADS_DIR="$U" BACKUP_DIR="$RB" KEEP_DAYS=1 KEEP_MIN=3 sh "$BK" 20260106_000000 >/dev/null 2>&1
caso "retenção mantém só os KEEP_MIN=3 mais recentes (e remove selo e manifesto junto)" '[ "$(ls "$RB"/uploads_*.tar.gz | wc -l | tr -d " ")" = 3 ] && [ "$(ls "$RB"/uploads_*.manifest | wc -l | tr -d " ")" = 3 ] && [ "$(ls "$RB"/uploads_*.sha256 | wc -l | tr -d " ")" = 3 ]'

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
