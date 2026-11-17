#!/bin/bash
# INF-07 — verificador de migrações de várias branches (prefixos repetidos, ordem, backfill).
#
# Uso:  scripts/check-migrations.sh [ref ...]
#   Sem argumentos: usa todas as branches locais que criam migrações em relação à main.
#   OVERRIDE=<dir>: substitui o SQL de migrações da união (what-if de uma correção proposta).
#   Variáveis: BASE (padrão main), AGENT (padrão hopper), PORT (padrão 55442; precisa do container de
#   scripts/test-db.ps1 rodando).
#
# Une as migrações de todas as refs com as da BASE e prova, em bancos descartáveis:
#   S0  mesmo nome + conteúdo diferente = erro; lista prefixos repetidos e o que ordena antes do fim da BASE
#   S1  banco NOVO: tudo aplica em ordem alfabética
#   S2  banco que já tem parte das novas (só N, se alcançável; ou tudo até N): o resto aplica por cima
#   S3  idem S1 e S4 idem S2, mas COM DADOS (seed-main.sql) e conferindo os backfills (verify.sql)
#   S5  o schema final (pg_dump -s) é IDÊNTICO em todos os cenários = a ordem de chegada não importa
# Sai com código != 0 se qualquer prova falhar. Bancos de teste são removidos no fim.
set -uo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; ROOTW="$(cygpath -m "$ROOT")"
BASE="${BASE:-main}"; AGENT="${AGENT:-hopper}"; PORT="${PORT:-55442}"; CT="mc-test-$AGENT-$PORT"
MIGDIR="packages/db/prisma/migrations"
HERE="$ROOT/scripts/migrations-check"
TMP="$(mktemp -d)"; TMPW="$(cygpath -m "$TMP")"
PASS=0; FAILS=0; DBS=()
ok()   { PASS=$((PASS+1)); echo "  [ok]    $1"; }
bad()  { FAILS=$((FAILS+1)); echo "  [FALHA] $1"; }
PSQL=(docker exec -i -e PGPASSWORD=meucardapio "$CT" psql -U meucardapio -X -q -v ON_ERROR_STOP=1)
cleanup() { for d in "${DBS[@]:-}"; do [ -n "$d" ] && "${PSQL[@]}" -d postgres -c "drop database if exists \"$d\"" >/dev/null 2>&1; done; rm -rf "$TMP"; }
trap cleanup EXIT

docker ps --format '{{.Names}}' | grep -qx "$CT" || { echo "container $CT não está rodando (rode scripts/test-db.ps1 -Agent $AGENT -Port $PORT)"; exit 2; }
G() { git -C "$ROOTW" "$@"; }   # git.exe (Windows) precisa de C:/...

# ---------- S0: montar a união ----------
REFS=("$@")
if [ ${#REFS[@]} -eq 0 ]; then
  while read -r b; do
    [ "$b" = "$BASE" ] && continue
    [ -n "$(G diff --name-only "$BASE...$b" -- "$MIGDIR" 2>/dev/null)" ] && REFS+=("$b")
  done < <(G for-each-ref refs/heads --format='%(refname:short)')
fi
echo "== S0 união de migrações: base=$BASE + ${#REFS[@]} branch(es)"
mkdir -p "$TMP/union"
extract() { # ref destino
  mkdir -p "$2"; G archive "$1" "$MIGDIR" | tar -x -C "$2" 2>/dev/null
  return 0
}
extract "$BASE" "$TMP/b"; BASE_NAMES=(); for d in "$TMP/b/$MIGDIR"/*/; do BASE_NAMES+=("$(basename "$d")"); done
[ ${#BASE_NAMES[@]} -gt 0 ] || { echo "ERRO: não consegui ler as migrações da base $BASE (git archive falhou)"; exit 2; }
cp -r "$TMP/b/$MIGDIR"/* "$TMP/union/"; rm -f "$TMP/union/migration_lock.toml"; cp "$TMP/b/$MIGDIR/migration_lock.toml" "$TMP/union/"
NEW=(); CONFLICT=0
for r in "${REFS[@]}"; do
  extract "$r" "$TMP/r"
  for d in "$TMP/r/$MIGDIR"/*/; do
    n="$(basename "$d")"
    if [ -d "$TMP/union/$n" ]; then
      if ! cmp -s "$d/migration.sql" "$TMP/union/$n/migration.sql"; then bad "mesmo nome, conteúdo diferente: $n (em $r)"; CONFLICT=1; fi
    else cp -r "$d" "$TMP/union/$n"; NEW+=("$n"); fi
  done
  rm -rf "$TMP/r"
done
# OVERRIDE=<dir com <nome>/migration.sql>: troca o SQL de migrações da união (testar uma correção proposta sem tocar na branch do dono)
if [ -n "${OVERRIDE:-}" ]; then for d in "$OVERRIDE"/*/; do n="$(basename "$d")"; [ -d "$TMP/union/$n" ] && cp "$d/migration.sql" "$TMP/union/$n/migration.sql" && echo "   OVERRIDE aplicado: $n"; done; fi
[ "$CONFLICT" = 0 ] && ok "nenhuma migração com mesmo nome e conteúdo divergente"
echo "   novas (${#NEW[@]}): ${NEW[*]:-nenhuma}"
[ ${#REFS[@]} -eq 0 ] && { echo "nenhuma branch com migrações novas: nada a testar (sucesso vazio, não é prova)"; exit 0; }
[ ${#NEW[@]} -eq 0 ] && { echo "as branches não trazem migrações que a base não tenha: nada a testar"; exit 0; }
ALL=(); for d in "$TMP/union"/*/; do ALL+=("$(basename "$d")"); done   # glob já vem em ordem alfabética (= ordem do Prisma)
LASTBASE="${BASE_NAMES[${#BASE_NAMES[@]}-1]}"
DUPS="$(printf '%s\n' "${ALL[@]}" | cut -c1-14 | sort | uniq -d)"
for p in $DUPS; do echo "   prefixo repetido $p: $(printf '%s ' "${ALL[@]}" | tr ' ' '\n' | grep "^$p" | tr '\n' ' ')"; done
for n in "${NEW[@]}"; do [[ "$n" < "$LASTBASE" ]] && echo "   AVISO: $n ordena ANTES da última migração da base ($LASTBASE)"; done
[ -z "$DUPS" ] && ok "sem prefixos repetidos" || echo "   (prefixos repetidos aplicam por ordem alfabética do nome; provado abaixo)"

# ---------- helpers de aplicação ----------
apply() { # db nome... -> aplica o conjunto de migrações via prisma migrate deploy
  local db="$1"; shift; local s="$TMP/set_$RANDOM$RANDOM"; mkdir -p "$s/migrations"
  G show "$BASE:packages/db/prisma/schema.prisma" > "$s/schema.prisma"
  cp "$TMP/union/migration_lock.toml" "$s/migrations/"
  for n in "$@"; do cp -r "$TMP/union/$n" "$s/migrations/$n"; done
  ( cd "$ROOT" && DATABASE_URL="postgresql://meucardapio:meucardapio@127.0.0.1:$PORT/$db?schema=public" \
      pnpm --filter @meucardapio/db exec prisma migrate deploy --schema "$(cygpath -m "$s")/schema.prisma" ) > "$TMP/last.log" 2>&1
}
newdb() { local d="chk_$1_$RANDOM"; "${PSQL[@]}" -d postgres -c "create database \"$d\"" >/dev/null; DBS+=("$d"); echo "$d"; }
schema_hash() { docker exec -e PGPASSWORD=meucardapio "$CT" pg_dump -U meucardapio -s --no-owner --no-acl "$1" | grep -vE '^(--|\\restrict|\\unrestrict)' | sha256sum | cut -c1-16; }
verify() { # db rótulo
  local out; out="$("${PSQL[@]}" -d "$1" -A -t -F '|' < "$HERE/verify.sql" 2>&1)" || { bad "$2: verify.sql falhou: $out"; return; }
  while IFS='|' read -r name okv det; do
    [ -z "$name" ] && continue
    case "$okv" in t) ok "$2 · $name";; f) bad "$2 · $name — $det";; *) echo "  [n/a]   $2 · $name";; esac
  done <<< "$out"
}
HASHES=()
note_hash() { HASHES+=("$2 $(schema_hash "$1")"); }

# ---------- S1 / S3: banco novo ----------
echo "== S1 banco NOVO: base + todas as novas"
D="$(newdb s1)"; if apply "$D" "${ALL[@]}"; then ok "aplicou ${#ALL[@]} migrações em ordem alfabética"; note_hash "$D" "S1-novo"; else bad "S1 falhou"; tail -8 "$TMP/last.log"; fi

echo "== S3 banco com DADOS na base + todas as novas (conferindo backfills)"
D="$(newdb s3)"; apply "$D" "${BASE_NAMES[@]}" || { bad "S3: base não aplicou"; tail -5 "$TMP/last.log"; }
"${PSQL[@]}" -d "$D" < "$HERE/seed-main.sql" >/dev/null || bad "S3: seed falhou: FIXTURE DESATUALIZADA em relação ao schema da main (atualize scripts/migrations-check/seed-main.sql)"
if apply "$D" "${ALL[@]}"; then ok "S3 aplicou as novas sobre dados existentes"; verify "$D" "S3"; note_hash "$D" "S3-dados"; else bad "S3 falhou"; tail -8 "$TMP/last.log"; fi

# ---------- S2 / S4: banco que já tem parte das novas ----------
# (a) "só N": a base + apenas N. Se N depende de outra migração nova, esse estado é INALCANÇÁVEL (nenhum
#     banco real aplica fora de ordem): vira [n/a] e o banco é descartado (o Prisma travaria com P3009).
# (b) "tudo até N": a base + todas as novas que ordenam até N (estado de um deploy parcial; sempre alcançável).
# Nos dois, o restante tem de aplicar por cima, com e sem dados, e os checks do verify.sql valem.
run_state() { # rótulo modo db nomes...  -> aplica o restante sobre o estado já montado e confere
  local rot="$1" modo="$2" d="$3"; shift 3
  if apply "$d" "${ALL[@]}"; then
    ok "[$modo] com $rot já aplicada, o restante aplicou por cima"; [ "$modo" = dados ] && verify "$d" "S4 $rot"; note_hash "$d" "S2-$modo-$rot"
  else bad "[$modo] com $rot já aplicada, a união FALHOU"; tail -10 "$TMP/last.log"; fi
}
for N in "${NEW[@]}"; do
  [ -n "${ONLY:-}" ] && [ "$N" != "$ONLY" ] && continue   # ONLY=<nome>: roda só o cenário dessa migração
  echo "== S2/S4 estados parciais em torno de: $N"
  UPTO=(); for m in "${ALL[@]}"; do [[ "$m" < "$N" || "$m" == "$N" ]] && UPTO+=("$m"); done
  for modo in vazio dados; do
    # (a) só N
    D="$(newdb s2a)"
    if ! apply "$D" "${BASE_NAMES[@]}"; then bad "[$modo] a base não aplicou (log abaixo)"; tail -8 "$TMP/last.log"; else
      [ "$modo" = dados ] && { "${PSQL[@]}" -d "$D" < "$HERE/seed-main.sql" >/dev/null || bad "[$modo] seed falhou: FIXTURE DESATUALIZADA (atualize seed-main.sql)"; }
      if apply "$D" "${BASE_NAMES[@]}" "$N"; then run_state "só $N" "$modo" "$D"
      else echo "  [n/a]   [$modo] só $N: estado inalcançável ($N depende de outra migração nova); pulado"; fi
    fi
    # (b) tudo até N
    D="$(newdb s2b)"
    if ! apply "$D" "${BASE_NAMES[@]}"; then bad "[$modo] a base não aplicou (log abaixo)"; tail -8 "$TMP/last.log"; continue; fi
    [ "$modo" = dados ] && { "${PSQL[@]}" -d "$D" < "$HERE/seed-main.sql" >/dev/null || bad "[$modo] seed falhou: FIXTURE DESATUALIZADA"; }
    if apply "$D" "${UPTO[@]}"; then run_state "tudo até $N" "$modo" "$D"
    else bad "[$modo] as migrações até $N não aplicaram na ordem (log abaixo)"; tail -8 "$TMP/last.log"; fi
  done
done

# ---------- S6: dados "no meio do caminho" (ganchos por migração) ----------
# Para uma migração N que tenha scripts/migrations-check/pre-N.sql: aplica tudo que ordena ANTES de N,
# semeia os dados de pre-N.sql (válidos naquele schema intermediário), aplica o resto e roda post-N.sql,
# que imprime linhas "nome|t/f|detalhe" como o verify.sql. Prova backfills que o schema da base não comporta.
for N in "${NEW[@]}"; do
  [ -f "$HERE/pre-$N.sql" ] || continue
  [ -n "${ONLY:-}" ] && [ "$N" != "$ONLY" ] && continue
  echo "== S6 dados intermediários antes de: $N"
  BEFORE=(); for m in "${ALL[@]}"; do [[ "$m" < "$N" ]] && BEFORE+=("$m"); done
  D="$(newdb s6)"
  if ! apply "$D" "${BEFORE[@]}"; then bad "S6: as ${#BEFORE[@]} migrações anteriores a $N não aplicaram"; tail -6 "$TMP/last.log"; continue; fi
  "${PSQL[@]}" -d "$D" < "$HERE/pre-$N.sql" > /dev/null || { bad "S6: pre-$N.sql falhou"; continue; }
  if apply "$D" "${ALL[@]}"; then
    ok "S6 aplicou $N e as seguintes sobre dados intermediários"
    if [ -f "$HERE/post-$N.sql" ]; then
      out="$("${PSQL[@]}" -d "$D" -A -t -F '|' < "$HERE/post-$N.sql" 2>&1)" || { bad "S6: post-$N.sql falhou: $out"; continue; }
      while IFS='|' read -r name okv det; do
        [ -z "$name" ] && continue
        case "$okv" in t) ok "S6 $N · $name";; f) bad "S6 $N · $name — $det";; *) echo "  [n/a]   S6 $N · $name";; esac
      done <<< "$out"
    fi
    note_hash "$D" "S6-$N"
  else bad "S6: $N falhou sobre dados intermediários"; tail -10 "$TMP/last.log"; fi
done

# ---------- S5: schema final igual em todos os cenários ----------
echo "== S5 schema final idêntico em todos os cenários"
UNIQ="$(printf '%s\n' "${HASHES[@]}" | awk '{print $2}' | sort -u | wc -l | tr -d ' ')"
if [ "$UNIQ" = 1 ] && [ ${#HASHES[@]} -gt 0 ]; then ok "${#HASHES[@]} bancos terminaram com o mesmo schema ($(printf '%s\n' "${HASHES[@]}" | awk '{print $2}' | sort -u))"
else bad "schemas divergentes entre cenários:"; printf '     %s\n' "${HASHES[@]}"; fi

echo; echo "RESULTADO: $PASS ok, $FAILS falhas"
[ "$FAILS" -eq 0 ]
