# ADR-0018 — Fonte única de verdade (SSOT) e testes-guarda

- Status: **Proposto** (Atlas, 19/11/2026), a aprovar pelo Claudio. Relacionados: documento interno do time, ADR-0009, ADR-0007.

## Contexto
A auditoria da main achou o mesmo dado em mais de um lugar: horário em três fontes (`Store.schedule`, `Store.openingHours` texto e o `isStoreOpenNow` do web), fuso `America/Sao_Paulo` fixo em ~15 arquivos apesar de `Store.timezone`, status e papéis redeclarados no web, total/frete recalculados no checkout, dois formatadores de moeda e o tíquete descrito em TypeScript e em C#.

## Decisão
1. **Cada dado nasce em uma coluna/tabela, é validado por um esquema zod em `packages/shared-types`, é servido por um DTO por lista de permissão e é exibido por um componente.** Regra de negócio é calculada só no servidor.
2. **Prévia no web é permitida** só se o servidor recalcular e a divergência virar erro explícito (padrão: `expectedUnitPriceCents` → 409 `ITEM_PRICE_CHANGED`).
3. **Todo tipo/constante compartilhado** (status, papéis, limites, formatadores, código de erro) mora em `shared-types`; o web importa.
4. **Testes-guarda** (um por tema) falham se surgir nova cópia: fuso, literais de status, `openingHours` no web, preço de plano em texto, `code` de erro sem catálogo, hex fora dos tokens, contrato do tíquete.
5. **Correções em PRs pequenos, um tema por PR**, na ordem do `SSOT.md` §6 (fuso → horário → frete/total → status → papéis/dinheiro → erros → plano → cores).

## Consequências
Menos bugs de divergência (loja fora de SP, "aberto" que o servidor recusa, frete diferente do cobrado). Custo: migração de dados do horário (texto → grade) e mudança em ~25 arquivos do web, em PRs separados; o front do sócio é dono do design system e dos componentes: as mudanças de tela vão como PROPOSTA a ele.
