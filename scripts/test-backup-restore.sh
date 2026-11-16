#!/bin/bash
# Teste ponta a ponta de backup + restauração, descartável.
#
#  origem  : o Postgres de teste do agente (scripts/test-db.ps1; padrão hopper, porta 55442; migrado + seed)
#  destino : container novo SEM porta publicada (só docker exec): servidor limpo onde o dump é restaurado
#
# Cenários:  (1) banco vazio é RECUSADO (regressão do B05)   (2) backup bom é aceito
#            (3) restauração em servidor novo bate linha a linha  (4) dump corrompido é REPROVADO
# Não usa dados reais nem o banco de dev. O destino e os arquivos temporários são removidos no fim.
set -euo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'   # Git Bash no Windows não pode reescrever caminhos do container

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT="${AGENT:-hopper}"; SRC_PORT="${SRC_PORT:-55442}"
SRC="mc-test-$AGENT-$SRC_PORT"; DST="mc-test-$AGENT-bkp-dst"
PW=meucardapio   # senha de TESTE do test-db.ps1
TMPD="$(mktemp -d)"
# docker.exe (Windows) precisa de caminhos do host no formato C:/...; dentro do container valem os caminhos Linux
TMPW="$(cygpath -m "$TMPD")"; ROOTW="$(cygpath -m "$ROOT")"
PASS=0; FAILS=0
check() { if [ "$1" = ok ]; then PASS=$((PASS+1)); echo "  [ok]   $2"; else FAILS=$((FAILS+1)); echo "  [FALHA] $2"; fi; }
cleanup() {
  docker rm -f "$DST" >/dev/null 2>&1 || true
  docker exec -e PGPASSWORD=$PW "$SRC" psql -U meucardapio -d postgres -c 'drop database if exists empty_db' >/dev/null 2>&1 || true
  docker exec "$SRC" rm -rf /backups /scripts >/dev/null 2>&1 || true
  rm -rf "$TMPD"
}
trap cleanup EXIT
docker rm -f "$DST" >/dev/null 2>&1 || true

SRCENV=(-e PGUSER=meucardapio -e PGPASSWORD=$PW -e PGHOST=localhost -e BACKUP_DIR=/backups)
DSTENV=(-e PGUSER=meucardapio -e PGPASSWORD=$PW -e PGHOST=localhost)

echo "== preparando origem ($SRC: migrations + seed) e destino novo (sem porta)"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$ROOT/scripts/test-db.ps1")" -Agent "$AGENT" -Port "$SRC_PORT" | tail -3
export DATABASE_URL="postgresql://meucardapio:$PW@127.0.0.1:$SRC_PORT/meucardapio?schema=public"
( cd "$ROOT" && pnpm db:seed 2>&1 | tail -2 )
docker run -d --name "$DST" -e POSTGRES_USER=meucardapio -e POSTGRES_PASSWORD=$PW -e POSTGRES_DB=meucardapio postgres:16-alpine >/dev/null
for _ in $(seq 1 40); do docker exec "$DST" pg_isready -U meucardapio -d meucardapio >/dev/null 2>&1 && break; sleep 1; done
docker exec "$SRC" rm -rf /scripts /backups; docker exec "$SRC" mkdir -p /backups
docker cp "$ROOTW/scripts/backup" "$SRC:/scripts"; docker cp "$ROOTW/scripts/backup" "$DST:/scripts"

echo "== (1) banco vazio deve ser recusado"
docker exec -e PGPASSWORD=$PW "$SRC" psql -U meucardapio -d postgres -c 'create database empty_db' >/dev/null
if docker exec "${SRCENV[@]}" -e PGDATABASE=empty_db "$SRC" sh /scripts/backup.sh >"$TMPD/empty.log" 2>&1; then
  check fail "backup de banco vazio foi aceito (deveria recusar)"
else
  check ok "backup de banco vazio recusado: $(tail -1 "$TMPD/empty.log" | cut -c1-110)"
fi
[ -z "$(docker exec "$SRC" sh -c 'ls /backups/*.dump 2>/dev/null')" ] && check ok "nenhum arquivo .dump deixado para trás" || check fail "sobrou dump de banco vazio"

echo "== (2) backup com dados"
if docker exec "${SRCENV[@]}" -e PGDATABASE=meucardapio "$SRC" sh /scripts/backup.sh >"$TMPD/ok.log" 2>&1; then check ok "backup aceito: $(tail -1 "$TMPD/ok.log" | cut -c1-120)"; else cat "$TMPD/ok.log"; check fail "backup válido recusado"; fi
DUMP="$(docker exec "$SRC" sh -c 'ls -1 /backups/*.dump | tail -1')"
SIZE="$(docker exec "$SRC" sh -c "wc -c < $DUMP" | tr -d ' ')"
[ "$SIZE" -gt 20000 ] && check ok "dump com $SIZE bytes (os dumps vazios do B05 tinham 836)" || check fail "dump pequeno demais: $SIZE bytes"
docker exec "${SRCENV[@]}" "$SRC" sh /scripts/healthcheck.sh && check ok "healthcheck do backup saudável" || check fail "healthcheck acusou falha com backup recente"
docker exec "${SRCENV[@]}" -e PGDATABASE=meucardapio "$SRC" sh /scripts/rowcounts.sh > "$TMPD/expected.txt"
echo "   origem: $(wc -l < "$TMPD/expected.txt" | tr -d ' ') tabelas, $(awk '{s+=$2} END{print s}' "$TMPD/expected.txt") linhas no total"

echo "== (3) restauração num servidor NOVO ($DST) e conferência linha a linha"
BASE="$(basename "$DUMP")"   # o selo .sha256 referencia o nome original do arquivo
docker cp "$SRC:$DUMP" "$TMPW/$BASE"; docker cp "$SRC:$DUMP.sha256" "$TMPW/$BASE.sha256"; docker cp "$TMPW/expected.txt" "$DST:/expected.txt"
docker exec "$DST" mkdir -p /restore
docker cp "$TMPW/$BASE" "$DST:/restore/$BASE"; docker cp "$TMPW/$BASE.sha256" "$DST:/restore/$BASE.sha256"
if docker exec "${DSTENV[@]}" "$DST" sh /scripts/restore-verify.sh "/restore/$BASE" /expected.txt >"$TMPD/rv.log" 2>&1; then
  check ok "restore-verify OK ($(grep -c 'restore-verify:' "$TMPD/rv.log") verificações)"; sed 's/^/   /' "$TMPD/rv.log"
else cat "$TMPD/rv.log"; check fail "restauração não bateu com a origem"; fi

echo "== (4) dump corrompido deve ser reprovado"
head -c $((SIZE / 2)) "$TMPD/$BASE" > "$TMPD/trunc.dump"
docker cp "$TMPW/trunc.dump" "$DST:/restore/trunc.dump"
if docker exec "${DSTENV[@]}" "$DST" sh /scripts/restore-verify.sh /restore/trunc.dump /expected.txt >"$TMPD/bad.log" 2>&1; then
  check fail "dump truncado foi aprovado"
else check ok "dump truncado reprovado: $(tail -1 "$TMPD/bad.log" | cut -c1-100)"; fi
LEFT="$(docker exec "${DSTENV[@]}" "$DST" psql -X -At -d postgres -c "select count(*) from pg_database where datname like 'restore_verify_%'")"
[ "$LEFT" = 0 ] && check ok "bases temporárias de verificação foram removidas" || check fail "sobraram $LEFT bases restore_verify_*"

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
