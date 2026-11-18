#!/bin/sh
# Imprime "tabela contagem" (contagem exata) de todas as tabelas do schema public, em ordem.
# Usa as variáveis PG* do ambiente. Serve para comparar origem x restauração.
set -eu
psql -X -At -F ' ' -c "
select table_name,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
from information_schema.tables
where table_schema='public' and table_type='BASE TABLE'
order by 1"
