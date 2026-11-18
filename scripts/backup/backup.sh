#!/bin/sh
# Backup lógico verificado do Postgres (formato custom do pg_dump).
#
# Regra: um backup só "existe" se passou na verificação. Dump vazio, truncado ou sem as
# tabelas do banco => exit 1, nenhum arquivo é deixado, a retenção NÃO é aplicada e o marcador
# LAST_OK não avança (o healthcheck do serviço fica "unhealthy"). Isso corrige o B05 (os dumps
# antigos tinham 836 bytes e nenhuma tabela, e ninguém percebeu).
#
# Variáveis: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (padrão libpq), BACKUP_DIR (/backups),
# KEEP_DAYS (14), KEEP_MIN (3 = nunca apaga os 3 mais recentes), MIN_TABLES (1).
set -eu
# Os dumps têm dados de clientes e hashes de senha: só o dono lê (H1-C1). Vale para arquivos novos
# (.dump, .sha256, LAST_OK) e para a pasta.
umask 077

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
KEEP_MIN="${KEEP_MIN:-3}"
MIN_TABLES="${MIN_TABLES:-1}"
: "${PGDATABASE:?defina PGDATABASE}"

log() { printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FALHA: $*"; rm -f "$TMP" "$TMP.sha256" 2>/dev/null || true; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d_%H%M%S)"
FINAL="$BACKUP_DIR/${PGDATABASE}_${STAMP}.dump"
TMP="$FINAL.partial"

# 1) Quantas tabelas o banco tem de verdade (fonte da verdade da verificação).
TABLES="$(psql -X -At -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")" \
  || fail "não consegui consultar o banco"
[ "$TABLES" -ge "$MIN_TABLES" ] || fail "banco com $TABLES tabelas (mínimo $MIN_TABLES): migrações aplicadas? backup recusado"

# 2) Dump.
pg_dump -F c --no-owner --no-acl -f "$TMP" || fail "pg_dump falhou"

# 3) Verificação: o sumário do arquivo tem de listar os dados de TODAS as tabelas.
[ -s "$TMP" ] || fail "arquivo vazio"
pg_restore -l "$TMP" > "$TMP.toc" 2>/dev/null || { rm -f "$TMP.toc"; fail "pg_restore não consegue ler o arquivo"; }
DUMPED="$(grep -c ' TABLE DATA ' "$TMP.toc" || true)"
HAS_MIG="$(grep -c ' TABLE DATA public _prisma_migrations ' "$TMP.toc" || true)"
rm -f "$TMP.toc"
[ "$DUMPED" -eq "$TABLES" ] || fail "dump lista $DUMPED tabelas de dados, o banco tem $TABLES"
[ "${REQUIRE_PRISMA_MIGRATIONS:-1}" = "0" ] || [ "$HAS_MIG" -ge 1 ] || fail "tabela _prisma_migrations ausente do dump"

# 4) Selo de integridade e publicação atômica.
( cd "$BACKUP_DIR" && sha256sum "$(basename "$TMP")" | sed "s/$(basename "$TMP")/$(basename "$FINAL")/" > "$(basename "$FINAL").sha256" )
mv "$TMP" "$FINAL"
SIZE="$(wc -c < "$FINAL" | tr -d ' ')"
printf '%s %s\n' "$(date -u +%s)" "$(basename "$FINAL")" > "$BACKUP_DIR/LAST_OK"
log "ok $(basename "$FINAL") ${SIZE} bytes, $DUMPED tabelas"

# 5) Retenção, só depois de um backup bom. Mantém sempre os KEEP_MIN mais recentes.
COUNT="$(ls -1 "$BACKUP_DIR"/*.dump 2>/dev/null | wc -l | tr -d ' ')"
if [ "$COUNT" -gt "$KEEP_MIN" ]; then
  OLD="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.dump' -mtime +"$KEEP_DAYS" | sort)"
  REMOVABLE=$((COUNT - KEEP_MIN))
  for f in $OLD; do
    [ "$REMOVABLE" -gt 0 ] || break
    rm -f "$f" "$f.sha256"; REMOVABLE=$((REMOVABLE - 1)); log "retenção: removido $(basename "$f")"
  done
fi
