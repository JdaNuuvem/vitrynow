# Instruções para agentes (Vitry)

## Ao receber uma atualização
- **Frontend (`apps/web`):** leia `docs/PARA-O-FRONTEND.md` antes de qualquer outra coisa. Ele lista correções PROPOSTAS (não aplicadas) e o que o backend mudou.

## Divisão de responsabilidades
- `apps/web` existente = do sócio. O lado backend/infra **não altera** telas, CSS, componentes nem o cliente HTTP existentes; só cria telas novas e deixa propostas em `docs/PARA-O-FRONTEND.md`.
- Backend (`apps/api`), `packages/*`, `infra/`, `scripts/`, `apps/print-client` = lado backend/infra.

## Fontes únicas (docs/SSOT.md)
Antes de duplicar um dado (fuso, dinheiro, status, cotação, textos de erro, cores), veja `docs/SSOT.md`: há guardas em teste que reprovam cópias novas.
