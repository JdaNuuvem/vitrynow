#!/bin/sh
# Prova de restauração: restaura um dump numa base NOVA (e descartável) e confere o resultado.
#
# Uso:  PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=... restore-verify.sh <arquivo.dump> [contagens_esperadas.txt]
#
# - O servidor alvo vem das variáveis PG* e DEVE ser um Postgres descartável/de teste.
#   Nunca aponte para produção: o script só cria e apaga uma base própria (restore_verify_*),
#   nunca toca em outra, mas a regra operacional é a mesma.
# - Confere: selo sha256 (se existir), pg_restore sem erro, todas as migrações do Prisma com
#   finished_at preenchido, e (se informado) contagem exata de linhas por tabela == a da origem.
set -eu

DUMP="${1:?uso: restore-verify.sh <arquivo.dump> [contagens_esperadas.txt]}"
EXPECTED="${2:-}"
[ -s "$DUMP" ] || { echo "restore-verify: arquivo ausente ou vazio: $DUMP"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
DB="restore_verify_$(date -u +%Y%m%d%H%M%S)_$$"
export PGDATABASE=postgres
ok=0
cleanup() { PGDATABASE=postgres psql -X -q -c "drop database if exists \"$DB\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [ -f "$DUMP.sha256" ]; then
  ( cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256" >/dev/null ) \
    || { echo "restore-verify: FALHA sha256 não confere"; exit 1; }
  echo "restore-verify: sha256 ok"
fi

psql -X -q -c "create database \"$DB\"" || { echo "restore-verify: não consegui criar a base de teste"; exit 1; }
pg_restore --exit-on-error --no-owner --no-acl -d "$DB" "$DUMP" || { echo "restore-verify: FALHA pg_restore"; exit 1; }
echo "restore-verify: pg_restore ok"

export PGDATABASE="$DB"
PENDING="$(psql -X -At -c "select count(*) from _prisma_migrations where finished_at is null")"
APPLIED="$(psql -X -At -c "select count(*) from _prisma_migrations")"
[ "$APPLIED" -ge 1 ] && [ "$PENDING" -eq 0 ] || { echo "restore-verify: FALHA migrações ($APPLIED aplicadas, $PENDING incompletas)"; exit 1; }
echo "restore-verify: $APPLIED migrações do Prisma, nenhuma incompleta"

if [ -n "$EXPECTED" ]; then
  sh "$HERE/rowcounts.sh" > "$DUMP.actual.$$"
  if diff -u "$EXPECTED" "$DUMP.actual.$$"; then
    echo "restore-verify: contagens por tabela idênticas à origem"
  else
    rm -f "$DUMP.actual.$$"; echo "restore-verify: FALHA contagens divergem"; exit 1
  fi
  rm -f "$DUMP.actual.$$"
fi
echo "restore-verify: OK"
